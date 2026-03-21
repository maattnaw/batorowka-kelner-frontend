import os
import json
import logging
import datetime
import re
from typing import Any, Dict, Optional, Tuple

import functions_framework
from google.cloud import firestore
import google.generativeai as genai
from flask import Response, stream_with_context

# Konfiguracja Loggera
logging.basicConfig(level=logging.INFO)
logger = logging.getLogger('fresca_waiter')

# Inicjalizacja Firestore (baza: kelnerfreska)
project_id = os.environ.get("GOOGLE_CLOUD_PROJECT", os.environ.get("GCP_PROJECT"))
db = firestore.Client(project=project_id, database="kelnerfreska") if project_id else firestore.Client(database="kelnerfreska")

# Konfiguracja Gemini
GENAI_API_KEY = os.environ.get("GOOGLE_API_KEY")
MODEL_NAME = "gemini-2.5-flash" 

if GENAI_API_KEY:
    genai.configure(api_key=GENAI_API_KEY)

# Stałe Struktury
DEFAULT_UI_STATE = {
    "view": "MAIN_MENU",
    "message": "Przepraszamy, wystąpił problem z systemem AI.",
    "options": ["Menu", "Wezwij Kelnera", "Rachunek"]
}

def _handle_fallback(session_ref: firestore.DocumentReference, current_cart: Dict, history: list) -> Tuple[str, int, dict]:
    logger.warning("Executing Fallback Strategy")
    fallback_ui_state = DEFAULT_UI_STATE
    error_entry = {
        "timestamp": datetime.datetime.now(datetime.timezone.utc).isoformat(),
        "type": "SYSTEM_ERROR",
        "details": "AI service unavailable, fallback triggered"
    }
    try:
        session_ref.set({
            "ui_state": fallback_ui_state,
            "conversation_history": history + [error_entry],
            "last_updated": firestore.SERVER_TIMESTAMP
        }, merge=True)
    except Exception:
        pass
    return json.dumps(fallback_ui_state), 200, {"Content-Type": "application/json"}

def _fetch_menu_from_db():
    try:
        menu_items = []
        docs = db.collection("menu").stream()
        for doc in docs:
            menu_items.append(doc.to_dict())
        
        wine_items = []
        wines = db.collection("wines").stream()
        for doc in wines:
            wine_items.append(doc.to_dict())
            
        return {"menu": menu_items, "wines": wine_items}
    except Exception as e:
        logger.error(f"Błąd podczas pobierania menu: {e}")
        return {"menu": [], "wines": []}

def robust_json_parse(text):
    text = text.strip()
    match = re.search(r'\{.*\}', text, re.DOTALL)
    if match:
        try:
            return json.loads(match.group(0))
        except:
            pass
    raise ValueError("Failed to parse JSON")

def generate_response_stream(session_ref, current_cart, history, action, prompt_context, system_instruction, session_id):
    try:
        model = genai.GenerativeModel(model_name=MODEL_NAME)
        response_stream = model.generate_content(
            f"SYSTEM: {system_instruction}
CONTEXT: {json.dumps(prompt_context, ensure_ascii=False)}",
            stream=True
        )

        full_text = ""
        for chunk in response_stream:
            try:
                chunk_text = chunk.text
                full_text += chunk_text
                yield f"data: {json.dumps({'type': 'chunk', 'text': chunk_text})}

"
            except:
                continue
        
        if "---JSON_START---" in full_text:
            ai_message, json_str = full_text.split("---JSON_START---", 1)
        else:
            ai_message = full_text
            json_str = "{}"
        
        try:
            ai_result = robust_json_parse(json_str)
        except:
            ai_result = {"ui_state": DEFAULT_UI_STATE, "cart": current_cart}

        new_ui_state = ai_result.get("ui_state", DEFAULT_UI_STATE)
        new_cart = ai_result.get("cart", current_cart)
        new_ui_state["message"] = ai_message.strip()
        
        session_ref.set({
            "cart": new_cart,
            "ui_state": new_ui_state,
            "conversation_history": history + [{"timestamp": datetime.datetime.now(datetime.timezone.utc).isoformat(), "user_action": action, "ai_response": ai_message.strip()}],
            "last_updated": firestore.SERVER_TIMESTAMP
        }, merge=True)
        
        yield f"data: {json.dumps({'type': 'end', 'options': new_ui_state.get('options', [])})}

"

    except Exception as ai_error:
        logger.error(f"AI Processing Failed: {ai_error}")
        fallback_body, _, _ = _handle_fallback(session_ref, current_cart, history)
        fallback_data = json.loads(fallback_body)
        yield f"data: {json.dumps({'type': 'chunk', 'text': fallback_data['message']})}

"
        yield f"data: {json.dumps({'type': 'end', 'options': fallback_data['options']})}

"

@functions_framework.http
def handle_waiter_interaction(request):
    # Prawidłowa obsługa CORS Preflight (zapytania OPTIONS)
    if request.method == "OPTIONS":
        headers = {
            "Access-Control-Allow-Origin": "*",  # Dla produkcji warto zawęzić do domeny frontendu
            "Access-Control-Allow-Methods": "POST, OPTIONS",
            "Access-Control-Allow-Headers": "Content-Type",
            "Access-Control-Max-Age": "3600",
        }
        return ("", 204, headers)

    # Nagłówki dla właściwej odpowiedzi strumieniowej (POST)
    response_headers = {
        "Access-Control-Allow-Origin": "*",
        "Content-Type": "text/event-stream",
        "Cache-Control": "no-cache",
        "Connection": "keep-alive",
    }
        
    data = request.get_json(silent=True)
    if not data:
        return ("Invalid JSON", 400, response_headers)

    session_id = data.get("table_id")
    action = data.get("message")

    if not session_id or not action:
        return ("Missing table_id or message", 400, response_headers)

    session_ref = db.collection("sessions").document(session_id)
    session_snap = session_ref.get()
    
    if action == "START":
        session_ref.set({"cart": {"items": [], "total": 0.0}, "conversation_history": [], "ui_state": {"view": "WELCOME", "message": "Witamy!", "options": ["Menu", "Wezwij Kelnera"]}})
        current_data = session_ref.get().to_dict()
    else:
        current_data = session_snap.to_dict() if session_snap.exists else {"cart": {"items": [], "total": 0.0}, "conversation_history": [], "ui_state": {"view": "WELCOME", "message": "Witamy!", "options": ["Menu", "Wezwij Kelnera"]}}

    db_data = _fetch_menu_from_db()
    system_instruction = f"Jesteś kelnerem Fresca Napoli. Baza: {json.dumps(db_data, ensure_ascii=False)}. Zasady: KRÓTKO, paruj wino, dodaj notkę o wieku, Przycisk Wróć do Menu. Format: [Tekst] ---JSON_START--- {json}"
    
    return Response(stream_with_context(generate_response_stream(
        session_ref, current_data.get("cart", {}), current_data.get("conversation_history", []), action, {"cart": current_data.get("cart", {})}, system_instruction, session_id
    )), headers=response_headers)