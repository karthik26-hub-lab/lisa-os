import os
import json
from google import genai
from google.genai import types
from dotenv import load_dotenv

load_dotenv()

# Short-term memory buffer
STM_BUFFER = []
MAX_STM_TURNS = 10

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

def process_whisperflow(raw_text: str, app_context: dict) -> str:
    """
    Takes raw transcribed speech and OS context,
    uses short-term memory, and returns a polished prompt.
    """
    global STM_BUFFER
    api_key = os.environ.get("GEMINI_API_KEY")
    if not api_key:
        return raw_text 
    
    try:
        client = genai.Client(api_key=api_key)
        
        # Build Context Block
        context_block = f"""
APPLICATION CONTEXT:
Active Window Title: {app_context.get('active_window', 'Unknown')}
Selected Text: {app_context.get('selected_text', 'None')}

RECENT CONVERSATION (Short-Term Memory):
"""
        for i, turn in enumerate(STM_BUFFER):
            context_block += f"Turn {i+1} - User said: {turn['raw']}\nTurn {i+1} - You typed: {turn['polished']}\n"

        if not STM_BUFFER:
            context_block += "(No recent conversation)\n"

        sys_prompt = (
            "You are the WhisperFlow dictation engine with Short-Term Memory.\n\n"
            "Your ONLY job is to take the user's raw transcribed speech and convert it into a highly polished text prompt to be typed into the active application.\n"
            "Remove all filler words (umm, ah, like, you know) and fix grammar, BUT preserve the user's intended meaning completely.\n"
            "Do NOT answer the user. Do NOT converse. Output ONLY the text that should be typed.\n"
            "Do NOT wrap the output in markdown code blocks or quotes unless the user explicitly dictates them.\n\n"
            "### CONTEXT AWARENESS ###\n"
            "You have access to the user's Application Context and Short-Term Memory.\n"
            "1. If the user refers to 'this', 'that', 'it', or 'the previous one', use the Recent Conversation to understand what they mean.\n"
            "2. If the user says 'make it more polite', they want you to rewrite their PREVIOUS polished text.\n"
            "3. If the user says 'refactor this' or 'fix this', look at the Selected Text and rewrite it according to their instruction.\n"
            "4. If the active window is VS Code or an IDE, and they speak code, format it properly as code.\n\n"
            f"--- CURRENT STATE ---\n{context_block}"
        )
        
        config = types.GenerateContentConfig(
            system_instruction=sys_prompt,
        )
        
        # We only send the raw text as the user prompt, as context is in system instructions
        response = generate_with_fallback(client, raw_text, config)
        polished_text = response.text.strip()
        
        # Update short term memory
        STM_BUFFER.append({"raw": raw_text, "polished": polished_text})
        if len(STM_BUFFER) > MAX_STM_TURNS:
            STM_BUFFER.pop(0)
            
        return polished_text
        
    except Exception as e:
        print(f"Error communicating with Cloud LLM: {str(e)}")
        return raw_text
