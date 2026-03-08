import asyncio
import os
from google.adk.agents import LlmAgent
from google.adk.runners import InMemoryRunner
from dotenv import load_dotenv

load_dotenv()

# Specialized Menu Agent
menu_agent = LlmAgent(
    name="MenuSpecialist",
    model="gemini-3-flash-preview",
    instruction="Jesteś ekspertem od menu restauracji Batorówka w Olkuszu. Twoim zadaniem jest odpowiadać na pytania o dania, składniki i ceny.",
    description="Agent zajmujący się menu i informacjami o potrawach."
)

# Coordinator Agent
coordinator = LlmAgent(
    name="BatorowkaManager",
    model="gemini-3-flash-preview",
    instruction="Jesteś głównym managerem AI restauracji Batorówka. Zarządzasz zapytaniami i delegujesz je do odpowiednich agentów pomocniczych.",
    sub_agents=[menu_agent]
)

async def main():
    runner = InMemoryRunner(agent=coordinator)
    await runner.run_debug("Co polecasz na obiad w Batorówce?")

if __name__ == "__main__":
    asyncio.run(main())
