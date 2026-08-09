import os
from google import genai
from google.genai import types
from dotenv import load_dotenv

load_dotenv()

def generate_with_fallback(client, contents, config):
    models = [
        'gemini-3.5-flash',
        'gemini-3.1-flash',
        'gemini-2.5-flash',
        'gemini-3.1-flash-lite',
        'gemini-2.5-flash-lite'
    ]
    last_error = None
    for model_name in models:
        try:
            return client.models.generate_content(
                model=model_name,
                contents=contents,
                config=config
            )
        except Exception as e:
            print(f"[Fallback] Model {model_name} failed: {e}")
            last_error = e
    raise Exception(f"All models failed. Last error: {last_error}")

def process_whisperflow(raw_text: str) -> str:
    """
    Takes raw transcribed speech, cleans it up, removes filler words,
    and returns a polished prompt.
    """
    api_key = os.environ.get("GEMINI_API_KEY")
    if not api_key:
        return raw_text # Fallback to raw text if no API key
    
    try:
        client = genai.Client(api_key=api_key)
        
        sys_prompt = (
            "You are the WhisperFlow dictation engine. "
            "Your ONLY job is to take the user's raw transcribed speech and convert it into a highly polished, clean text prompt. "
            "Remove all filler words (umm, ah, like, you know), fix grammatical errors, and ensure it reads professionally. "
            "Do NOT answer the user. Do NOT converse. Output ONLY the polished text. "
            "If the user is writing code, format it properly. "
            "DO NOT wrap the output in markdown code blocks or quotes."
        )
        
        config = types.GenerateContentConfig(
            system_instruction=sys_prompt,
        )
        
        response = generate_with_fallback(client, raw_text, config)
        return response.text.strip()
    except Exception as e:
        print(f"Error communicating with Cloud LLM: {str(e)}")
        return raw_text # Fallback to raw text if API fails
