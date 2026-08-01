import os
from google import genai
from dotenv import load_dotenv

load_dotenv()

def generate_cloud_response(prompt: str) -> str:
    """
    Calls the Google Gemini API for heavy reasoning tasks.
    """
    api_key = os.environ.get("GEMINI_API_KEY")
    if not api_key:
        return "Error: GEMINI_API_KEY is not set in the environment or .env file."
    
    try:
        client = genai.Client(api_key=api_key)
        
        # Inject the current system time into the assistant's brain
        from datetime import datetime
        current_time = datetime.now().strftime('%A, %B %d, %Y %I:%M %p')
        sys_prompt = f"You are LISA, an advanced, highly intelligent desktop AI assistant. The current date and time is {current_time}. Be concise, helpful, and friendly."
        
        # We use gemini-3.1-flash-lite for lightweight, rapid reasoning
        response = client.models.generate_content(
            model='gemini-3.1-flash-lite',
            contents=prompt,
            config=genai.types.GenerateContentConfig(
                system_instruction=sys_prompt,
            )
        )
        return response.text
    except Exception as e:
        return f"Error communicating with Cloud LLM: {str(e)}"

def generate_local_response(prompt: str) -> str:
    """
    Stub for local LLM routing (e.g. Ollama).
    Currently falls back to Cloud since local is uninstalled.
    """
    return generate_cloud_response(prompt)
