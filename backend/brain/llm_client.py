import os
import json
import asyncio
from google import genai
from google.genai import types
from dotenv import load_dotenv
from brain import memory_manager

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
    uses short-term and long-term memory, and returns a polished prompt.
    """
    global STM_BUFFER
    api_key = os.environ.get("GEMINI_API_KEY")
    if not api_key:
        return raw_text 
    
    try:
        client = genai.Client(api_key=api_key)
        
        # Build Context Block
        long_term_memory = memory_manager.get_full_memory_context()
        
        context_block = f"""
APPLICATION CONTEXT:
Active Window Title: {app_context.get('active_window', 'Unknown')}
Selected Text: {app_context.get('selected_text', 'None')}

LONG-TERM MEMORY:
{long_term_memory}

RECENT CONVERSATION (Short-Term Memory):
"""
        for i, turn in enumerate(STM_BUFFER):
            context_block += f"Turn {i+1} - User said: {turn['raw']}\nTurn {i+1} - You typed: {turn['polished']}\n"

        if not STM_BUFFER:
            context_block += "(No recent conversation)\n"

        sys_prompt = (
            "You are the WhisperFlow dictation engine with Advanced Memory.\n\n"
            "Your ONLY job is to take the user's raw transcribed speech and convert it into a highly polished text prompt to be typed into the active application.\n"
            "Remove all filler words and fix grammar, BUT preserve the user's intended meaning completely.\n"
            "Do NOT answer the user. Do NOT converse. Output ONLY the text that should be typed.\n\n"
            "### CONTEXT AWARENESS ###\n"
            "You have access to the user's Application Context, Long-Term Memory, and Short-Term Memory.\n"
            "1. If the user refers to 'this', 'that', 'it', or 'the previous one', use the Recent Conversation to understand what they mean.\n"
            "2. Ensure your polished text adheres to any ACTIVE TASKS or USER PREFERENCES in the Long-Term Memory.\n"
            "3. If the user says 'refactor this' or 'fix this', look at the Selected Text and rewrite it according to their instruction.\n\n"
            f"--- CURRENT STATE ---\n{context_block}"
        )
        
        config = types.GenerateContentConfig(
            system_instruction=sys_prompt,
        )
        
        # We only send the raw text as the user prompt
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

async def run_memory_agent(raw_text: str, polished_text: str):
    """Runs asynchronously in the background to analyze conversation and update Long-Term Memory."""
    api_key = os.environ.get("GEMINI_API_KEY")
    if not api_key:
        return
        
    try:
        client = genai.Client(api_key=api_key)
        
        tool_save_pref = types.FunctionDeclaration(
            name="save_preference",
            description="Saves a stable user preference to long term memory (e.g. 'Prefers React', 'Uses snake_case').",
            parameters=types.Schema(
                type="OBJECT",
                properties={
                    "key": types.Schema(type="STRING", description="Short identifier for the preference."),
                    "value": types.Schema(type="STRING", description="The preference detail.")
                },
                required=["key", "value"]
            )
        )
        
        tool_update_proj = types.FunctionDeclaration(
            name="update_project",
            description="Saves or updates context about a specific project.",
            parameters=types.Schema(
                type="OBJECT",
                properties={
                    "project_name": types.Schema(type="STRING"),
                    "context": types.Schema(type="STRING", description="Details about the project.")
                },
                required=["project_name", "context"]
            )
        )
        
        tool_start_task = types.FunctionDeclaration(
            name="start_task",
            description="Starts tracking a new active task for the user.",
            parameters=types.Schema(
                type="OBJECT",
                properties={
                    "task_name": types.Schema(type="STRING", description="Short name of the task."),
                    "description": types.Schema(type="STRING", description="What the user is currently trying to accomplish.")
                },
                required=["task_name", "description"]
            )
        )
        
        tool_complete_task = types.FunctionDeclaration(
            name="complete_task",
            description="Marks an active task as completed. Call this when the user finishes a task or moves on.",
            parameters=types.Schema(
                type="OBJECT",
                properties={
                    "task_name": types.Schema(type="STRING")
                },
                required=["task_name"]
            )
        )
        
        sys_prompt = (
            "You are a background Memory Agent. You silently observe the user's dictation and extract long-term memory, projects, and active tasks.\n"
            "Do NOT save temporary chatter or single actions. Only save things that represent a continuing task, a permanent preference, or a project fact.\n"
            "If the user says 'I am working on X', start a task. If they say 'Done with X', complete it.\n"
            "You must use the provided tools to save memory. If nothing needs to be saved, simply return 'NO_ACTION'."
        )
        
        config = types.GenerateContentConfig(
            system_instruction=sys_prompt,
            tools=[types.Tool(function_declarations=[tool_save_pref, tool_update_proj, tool_start_task, tool_complete_task])],
            temperature=0.1
        )
        
        prompt = f"User spoke: {raw_text}\nSystem typed: {polished_text}\nShould anything be remembered?"
        
        # We can just use the standard generate_content here because tools are strictly defined
        response = client.models.generate_content(
            model='gemini-2.5-flash',
            contents=prompt,
            config=config
        )
        
        if response.function_calls:
            for call in response.function_calls:
                args = {k: v for k, v in call.args.items()}
                if call.name == "save_preference":
                    memory_manager.save_preference(**args)
                elif call.name == "update_project":
                    memory_manager.update_project(**args)
                elif call.name == "start_task":
                    memory_manager.start_task(**args)
                elif call.name == "complete_task":
                    memory_manager.complete_task(**args)
                    
    except Exception as e:
        print(f"[Memory Agent Error] {e}")
