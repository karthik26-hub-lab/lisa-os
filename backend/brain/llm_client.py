import os
from google import genai
from google.genai import types
from dotenv import load_dotenv
from .tools import (
    analyze_screen,
    open_application,
    open_website,
    get_system_info,
    find_and_click_element,
    type_text,
    press_key,
    scroll_screen,
    move_mouse,
    click_on_screen
)
from datetime import datetime

load_dotenv()

# Expose these functions to Gemini
TOOL_FUNCTIONS = [
    analyze_screen,
    open_application,
    open_website,
    get_system_info,
    find_and_click_element,
    type_text,
    press_key,
    scroll_screen,
    move_mouse,
    click_on_screen
]

import json
import uuid

HISTORY_FILE = os.path.join(os.path.dirname(__file__), "chat_history.json")
MAX_HISTORY_TURNS = 50
CURRENT_SESSION_ID = None

def load_history():
    global CURRENT_SESSION_ID
    if not os.path.exists(HISTORY_FILE):
        data = {}
    else:
        try:
            with open(HISTORY_FILE, "r", encoding="utf-8") as f:
                data = json.load(f)
        except:
            data = {}
            
    # Auto-migrate legacy list format
    if isinstance(data, list):
        data = {
            "legacy_session": {
                "title": "Legacy Session",
                "messages": data
            }
        }
        
    if not CURRENT_SESSION_ID:
        CURRENT_SESSION_ID = f"session_{uuid.uuid4().hex[:8]}"
        current_time = datetime.now().strftime('%A, %B %d, %Y %I:%M %p')
        data[CURRENT_SESSION_ID] = {
            "title": current_time,
            "messages": []
        }
        
    return data

def save_history(history_dict):
    try:
        with open(HISTORY_FILE, "w", encoding="utf-8") as f:
            json.dump(history_dict, f, indent=2)
    except Exception as e:
        print(f"[Memory] Failed to save history: {e}")

def generate_with_fallback(client, contents, config):
    models = [
        'gemini-3.1-flash-lite',
        'gemini-3.5-flash-lite',
        'gemini-2.5-flash-lite',
        'gemini-3.5-flash',
        'gemini-3.1-flash',
        'gemini-2.5-flash'
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

def generate_cloud_response(prompt: str) -> str:
    """
    Calls the Google Gemini API, capable of executing OS tools and maintaining memory.
    """
    global CURRENT_SESSION_ID
    api_key = os.environ.get("GEMINI_API_KEY")
    if not api_key:
        return "Error: GEMINI_API_KEY is not set in the environment or .env file."
    
    try:
        client = genai.Client(api_key=api_key)
        current_time = datetime.now().strftime('%A, %B %d, %Y %I:%M %p')
        sys_prompt = f"You are LISA, an advanced desktop AI assistant. The current date and time is {current_time}. You have tools to control the OS, including full telekinetic control over the mouse and keyboard. When asked to perform an action, use the appropriate tool. Be concise, helpful, and friendly. CRITICAL: You DO have perfect memory of past conversations. The previous messages are included in your context. NEVER say you don't have access to logs or memory. If asked about history, just summarize the previous messages provided to you. IMPORTANT: If the user asks what is on their screen, or asks you to look at their screen, you MUST call the analyze_screen tool. If the user asks you to click on something, use the find_and_click_element tool to locate and click it!"
        
        config = types.GenerateContentConfig(
            system_instruction=sys_prompt,
            tools=TOOL_FUNCTIONS,
        )
        
        # Load memory
        history_dict = load_history()
        current_session_messages = history_dict[CURRENT_SESSION_ID]["messages"]
        
        contents = []
        for msg in current_session_messages:
            # We only store pure text interactions to keep context clean
            if msg.get("text"):
                contents.append(types.Content(role=msg["role"], parts=[types.Part.from_text(text=msg["text"])]))
                
        # Append current user prompt
        contents.append(types.Content(role="user", parts=[types.Part.from_text(text=prompt)]))
        current_session_messages.append({"role": "user", "text": prompt})
        
        response = generate_with_fallback(client, contents, config)
        
        final_text = ""
        
        # Handle potential function calls
        if response.function_calls:
            # Add the model's function call request to the conversation history temporarily
            contents.append(response.candidates[0].content)
            
            function_responses = []
            for fc in response.function_calls:
                name = fc.name
                args = fc.args
                print(f"[Tools] LLM invoked {name} with args {args}")
                
                # Execute the corresponding local python function
                try:
                    if name == "open_application":
                        res = open_application(**args)
                    elif name == "open_website":
                        res = open_website(**args)
                    elif name == "get_system_info":
                        res = get_system_info()
                    elif name == "analyze_screen":
                        res = analyze_screen(**args)
                    else:
                        res = f"Tool {name} not found."
                except Exception as e:
                    res = f"Error executing tool: {str(e)}"
                    
                print(f"[Tools] Result: {res}")
                function_responses.append(
                    types.Part.from_function_response(name=name, response={"result": res})
                )
            
            # Append the results of the function execution as a new user message temporarily
            contents.append(types.Content(role="user", parts=function_responses))
            
            # Ask the model to generate the final natural language answer based on the tool results
            final_response = generate_with_fallback(client, contents, config)
            final_text = final_response.text
        else:
            final_text = response.text

        # Save AI's final text response to persistent memory
        if final_text:
            current_session_messages.append({"role": "model", "text": final_text})
            history_dict[CURRENT_SESSION_ID]["messages"] = current_session_messages[-(MAX_HISTORY_TURNS * 2):]
            save_history(history_dict)
            
        return final_text
    except Exception as e:
        return f"Error communicating with Cloud LLM: {str(e)}"

def generate_local_response(prompt: str) -> str:
    """
    Stub for local LLM routing (e.g. Ollama).
    Currently falls back to Cloud since local is uninstalled.
    """
    return generate_cloud_response(prompt)
