import os
import json
import logging
import datetime
import re
from typing import Any, Dict, Optional, Tuple

import functions_framework
from google.cloud import firestore
import google.generativeai as genai

# Konfiguracja Loggera
logging.basicConfig(level=logging.INFO)
logger = logging.getLogger('fresca_waiter')

# Inicjalizacja Firestore (baza: kelnerfreska)
project_id = os.environ.get("GOOGLE_CLOUD_PROJECT", os.environ.get("GCP_PROJECT"))
if project_id:
    db = firestore.Client(project=project_id, database="kelnerfreska")
else:
    db = firestore.Client(database="kelnerfreska")

# Konfiguracja Gemini
GENAI_API_KEY = os.environ.get("GOOGLE_API_KEY")
MODEL_NAME = "gemini-2.5-pro" # Wersja produkcyjna o wysokiej wydajności

if GENAI_API_KEY:
    genai.configure(api_key=GENAI_API_KEY)

# Stałe Struktury
DEFAULT_UI_STATE = {
    "view": "MAIN_MENU",
    "message": "Przepraszamy, wystąpił problem z systemem AI. Wróciliśmy do menu głównego.",
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
        session_ref.update({
            "ui_state": fallback_ui_state,
            "conversation_history": history + [error_entry],
            "last_updated": firestore.SERVER_TIMESTAMP
        })
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
        logger.error(f"Błąd podczas pobierania menu z Firestore: {e}")
        return {"menu": [], "wines": []}

def robust_json_parse(text):
    text = text.strip()
    # Try finding JSON within markdown blocks
    match = re.search(r'```(?:json)?\s*(\{.*?\})\s*```', text, re.DOTALL)
    if match:
        try:
            return json.loads(match.group(1))
        except json.JSONDecodeError:
            pass
            
    # Fallback: find first { and last }
    start = text.find('{')
    end = text.rfind('}')
    if start != -1 and end != -1 and end > start:
        try:
            return json.loads(text[start:end+1])
        except json.JSONDecodeError:
            pass
            
    raise ValueError("Failed to parse JSON")

@functions_framework.http
def handle_waiter_interaction(request):
    cors_headers = {
        "Access-Control-Allow-Origin": "*",
        "Access-Control-Allow-Methods": "POST, OPTIONS",
        "Access-Control-Allow-Headers": "Content-Type"
    }

    if request.method == "OPTIONS":
        return ("", 204, cors_headers)
        
    try:
        data = request.get_json(silent=True)
        if not data:
            return json.dumps({"error": "Brak ciała żądania"}), 400, {"Content-Type": "application/json", **cors_headers}
            
        session_id = data.get("table_id")
        action = data.get("message")
        payload = data.get("payload", {})

        if not session_id or not action:
            return json.dumps({"error": "Brak wymaganych pól: session_id lub action"}), 400, {"Content-Type": "application/json", **cors_headers}

        session_ref = db.collection("sessions").document(session_id)
        
        if action == "START":
            current_data = {
                "cart": {"items": [], "total": 0.0},
                "conversation_history": [],
                "ui_state": {"view": "WELCOME", "message": "Witamy we Fresca Napoli!", "options": ["Menu", "Wezwij Kelnera", "For other languages - Write your request"]}
            }
            session_ref.set(current_data)
        else:
            session_snap = session_ref.get()
            if not session_snap.exists:
                current_data = {
                    "cart": {"items": [], "total": 0.0},
                    "conversation_history": [],
                    "ui_state": {"view": "WELCOME", "message": "Witamy we Fresca Napoli!", "options": ["Menu", "Wezwij Kelnera", "For other languages - Write your request"]}
                }
                session_ref.set(current_data)
            else:
                current_data = session_snap.to_dict()

        current_cart = current_data.get("cart", {"items": [], "total": 0.0})
        history = current_data.get("conversation_history", [])

        # POBIERANIE MENU
        db_data = _fetch_menu_from_db()
        menu_json = json.dumps(db_data, ensure_ascii=False)

        system_instruction = f"""
Jesteś pełnym pasji, naturalnym kelnerem we włoskiej restauracji Fresca Napoli. Masz w sobie prawdziwą włoską gościnność (hospitality) - jesteś luźny, serdeczny i uśmiechnięty, unikasz sztywnych i sztucznych sformułowań.
Oto aktualne MENU restauracji oraz BAZA WIN (pobrane z bazy danych):
{menu_json}

ZASADY (STRICT MODE):
1. KRÓTKIE KOMUNIKATY I ZAKAZ WYMIENIANIA DAŃ W TEKŚCIE: Masz TWARDY ZAKAZ wymieniania nazw dań, napojów lub ich cen w tekście odpowiedzi (w dymku czatu), jeśli te same pozycje są wysyłane jako przyciski w tablicy `options` w `ui_state`. Jako kelner pisz WYŁĄCZNIE krótkie, luźne, konwersacyjne pytania (np. "Na co masz dziś ochotę?", "Co wybierasz, amico?", "Oto co dla Was mamy:"). Całą prezentację asortymentu zostaw przyciskom.
2. GUIDED FLOW (Krok po kroku): Prezentuj kategorie poprzez tablicę `options`. Jeśli klient wybierze kategorię (np. "Pizza"), zaprezentuj tylko podkategorie lub konkretne pizze jako przyciski, nie wszystko na raz.
3. STRICT MODE (Anti-Hallucination): Zawsze sprawdzaj dostępność w przekazanej bazie.
4. LOGIKA WIN (Włoska Gościnność): Gdy klient wybiera danie główne lub makaron, MUSISZ zaproponować wino. 
   - W tekście odpowiedzi (wiadomość dla klienta) MUSISZ dobrać JEDNO konkretne wino z bazy pasujące do zamówienia (np. do bolognese) wraz z krótkim, smacznym uzasadnieniem dlaczego pasuje (np. "Do tego makaronu świetnie siądzie nasze Chianti, świetnie podbija smak pomidorów!").
   - W `options` (przyciski) MUSISZ zawsze podać opcje: "Kieliszek Ricò Bianco", "Kieliszek Ricò Rosso", nazwa zaproponowanego wina, "Karta win", "Nie dziękuję".
5. NAWIGACJA I PRZYCISKI: Upewnij się, że każda Twoja odpowiedź generuje odpowiednie opcje w tablicy `options`, by klient miał przyciski do kliknięcia.
6. ALERGENY I SKŁADNIKI: Wyjaśniaj je tylko wtedy, gdy klient wyraźnie o to zapyta.
7. WTORKOWA PROMOCJA: Pamiętaj o uwzględnieniu wtorkowej promocji na pizzę.
8. PŁATNOŚCI I ZAKOŃCZENIE ZAMÓWIENIA: Jeśli klient prosi o podsumowanie i zapłatę, wygeneruj luźne pytanie o formę płatności i przyciski (np. "Gotówka", "Karta"). Ustaw poprawnie flagi `call_waiter`, `payment_type` i `finalize_order`.

FORMAT ODPOWIEDZI:
Ze względu na streaming, Twoja odpowiedź MUSI składać się z dwóch części:
Najpierw napisz treść wiadomości dla klienta (luźny, włoski komunikat, uzasadnienie wina itp., bez pełnej listy dań).
Potem wstaw DOKŁADNIE tekst: ---JSON_START---
A po nim wstaw czysty obiekt JSON ze stanem (bez znaczników markdown).

Przykład odpowiedzi:
Mamma mia, świetny wybór! Do tego dania idealnie pasuje nasze Primitivo, fajnie podkręci smak mięsa. Może kieliszek?
---JSON_START---
{{
  "ui_state": {{
      "view": "MAIN_MENU",
      "options": ["Kieliszek Ricò Bianco", "Kieliszek Ricò Rosso", "Primitivo", "Karta win", "Nie dziękuję"]
  }},
  "cart": {{"items": [], "total": 0.0}},
  "call_waiter": false,
  "payment_type": null,
  "finalize_order": false
}}
"""

        prompt_context = {
            "current_cart": current_cart,
            "last_history": history[-5:],
            "user_action": action,
            "action_payload": payload
        }

        from flask import Response
        
        try:
            def generate():
                try:
                    model = genai.GenerativeModel(model_name=MODEL_NAME)
                    response = model.generate_content(
                        f"System Instruction: {system_instruction}\n\nContext Data: {json.dumps(prompt_context, ensure_ascii=False)}",
                        stream=True
                    )
                    
                    full_text = ""
                    json_started = False
                    text_buffer = ""
                    
                    for chunk in response:
                        if chunk.text:
                            chunk_str = chunk.text
                            full_text += chunk_str
                            
                            if not json_started:
                                text_buffer += chunk_str
                                if "---JSON_START---" in text_buffer:
                                    parts = text_buffer.split("---JSON_START---", 1)
                                    safe_text = parts[0]
                                    json_started = True
                                    if safe_text:
                                        yield f"data: {json.dumps({'text': safe_text})}\n\n"
                                else:
                                    if len(text_buffer) > 20:
                                        safe_text = text_buffer[:-20]
                                        text_buffer = text_buffer[-20:]
                                        yield f"data: {json.dumps({'text': safe_text})}\n\n"
                    
                    if not json_started and text_buffer:
                        if "---JSON_START---" in text_buffer:
                            parts = text_buffer.split("---JSON_START---", 1)
                            if parts[0]:
                                yield f"data: {json.dumps({'text': parts[0]})}\n\n"
                        else:
                            yield f"data: {json.dumps({'text': text_buffer})}\n\n"

                    if "---JSON_START---" in full_text:
                        msg_part, json_part = full_text.split("---JSON_START---", 1)
                        ai_message = msg_part.strip()
                        ai_result = robust_json_parse(json_part)
                    else:
                        ai_message = full_text.strip()
                        ai_result = robust_json_parse(full_text)
                    
                    if "ui_state" not in ai_result or "cart" not in ai_result:
                        raise ValueError("AI zwróciło niekompletny JSON")

                    new_ui_state = ai_result["ui_state"]
                    new_cart = ai_result["cart"]
                    new_ui_state["message"] = ai_message
                    
                    call_waiter = ai_result.get("call_waiter", False)
                    payment_type = ai_result.get("payment_type")
                    finalize_order = ai_result.get("finalize_order", False)
                    
                    if finalize_order or call_waiter:
                        try:
                            obsluga_ref = db.collection("obsluga").document()
                            obsluga_ref.set({
                                "table": session_id,
                                "items": new_cart.get("items", []),
                                "total": new_cart.get("total", 0.0),
                                "payment_type": payment_type if payment_type else "nieznana",
                                "call_waiter": call_waiter,
                                "status": "pending",
                                "timestamp": firestore.SERVER_TIMESTAMP
                            })
                            logger.info(f"Zapisano zamówienie/zgłoszenie do obsługi dla stolika {session_id}")
                        except Exception as e:
                            logger.error(f"Błąd zapisu do kolekcji obsluga: {e}")

                    new_history_entry = {
                        "timestamp": datetime.datetime.now(datetime.timezone.utc).isoformat(),
                        "user_action": action,
                        "ai_response": ai_message
                    }

                    session_ref.update({
                        "cart": new_cart,
                        "ui_state": new_ui_state,
                        "conversation_history": history + [new_history_entry],
                        "last_updated": firestore.SERVER_TIMESTAMP
                    })
                    
                    yield f"data: {json.dumps({'type': 'actions', 'ui_state': new_ui_state})}\n\n"

                except Exception as ai_error:
                    logger.error(f"AI Processing Failed: {ai_error}")
                    fallback_body, fallback_status, fallback_headers = _handle_fallback(session_ref, current_cart, history)
                    fallback_state = json.loads(fallback_body)
                    yield f"data: {json.dumps({'type': 'actions', 'ui_state': fallback_state})}\n\n"
            
            return Response(generate(), status=200, mimetype='text/event-stream', headers={
                "Access-Control-Allow-Origin": "*",
                "Access-Control-Allow-Methods": "POST, OPTIONS",
                "Access-Control-Allow-Headers": "Content-Type",
                "Cache-Control": "no-cache",
                "Connection": "keep-alive"
            })

        except Exception as ai_error:
            logger.error(f"General AI Block Error: {ai_error}")
            fallback_body, fallback_status, fallback_headers = _handle_fallback(session_ref, current_cart, history)
            return Response(fallback_body, status=200, mimetype='application/json', headers=cors_headers)

    except Exception as e:
        logger.critical(f"Critical System Error: {e}")
        return json.dumps({"error": "Wystąpił krytyczny błąd systemu."}), 500, {"Content-Type": "application/json", **cors_headers}
