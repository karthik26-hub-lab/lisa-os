import os
from google import genai
from google.genai import types
from dotenv import load_dotenv
from .tools import open_application, open_website, get_system_info
from datetime import datetime

load_dotenv()

# Expose these functions to Gemini
TOOL_FUNCTIONS = [open_application, open_website, get_system_info]

def generate_cloud_response(prompt: str) -> str:
    """
    Calls the Google Gemini API, capable of executing OS tools.
    """
    api_key = os.environ.get("GEMINI_API_KEY")
    if not api_key:
        return "Error: GEMINI_API_KEY is not set in the environment or .env file."
    
    try:
        client = genai.Client(api_key=api_key)
        current_time = datetime.now().strftime('%A, %B %d, %Y %I:%M %p')
        sys_prompt = f"You are LISA, an advanced desktop AI assistant. The current date and time is {current_time}. You have tools to control the OS. When asked to perform an action, use the appropriate tool. Be concise, helpful, and friendly."
        
        config = types.GenerateContentConfig(
            system_instruction=sys_prompt,
            tools=TOOL_FUNCTIONS,
        )
        
        contents = [types.Content(role="user", parts=[types.Part.from_text(text=prompt)])]
        
        response = client.models.generate_content(
            model='gemini-3.1-flash-lite',
            contents=contents,
            config=config
        )
        
        # Handle potential function calls
        if response.function_calls:
            # Add the model's function call request to the conversation history
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
                    else:
                        res = f"Tool {name} not found."
                except Exception as e:
                    res = f"Error executing tool: {str(e)}"
                    
                print(f"[Tools] Result: {res}")
                function_responses.append(
                    types.Part.from_function_response(name=name, response={"result": res})
                )
            
            # Append the results of the function execution as a new user message
            contents.append(types.Content(role="user", parts=function_responses))
            
            # Ask the model to generate the final natural language answer based on the tool results
            final_response = client.models.generate_content(
                model='gemini-3.1-flash-lite',
                contents=contents,
                config=config
            )
            return final_response.text

        return response.text
    except Exception as e:
        return f"Error communicating with Cloud LLM: {str(e)}"

def generate_local_response(prompt: str) -> str:
    """
    Stub for local LLM routing (e.g. Ollama).
    Currently falls back to Cloud since local is uninstalled.
    """
    return generate_cloud_response(prompt)
