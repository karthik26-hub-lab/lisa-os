import subprocess
import webbrowser
import psutil
import os
from PIL import ImageGrab
from google import genai

def analyze_screen(query: str) -> str:
    """
    Takes an instant screenshot of the user's desktop and uses Gemini Multimodal Vision to answer the query.
    """
    try:
        api_key = os.environ.get("GEMINI_API_KEY")
        if not api_key:
            return "Error: GEMINI_API_KEY is missing."
            
        # Take a screenshot of all monitors
        img = ImageGrab.grab(all_screens=True).convert("RGB")
        
        client = genai.Client(api_key=api_key)
        contents = [f"Look at this screenshot of my screen and answer: {query}", img]
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
                response = client.models.generate_content(
                    model=model_name,
                    contents=contents
                )
                return response.text
            except Exception as e:
                print(f"[Vision Fallback] {model_name} failed: {e}")
                last_error = e
        
        return f"Failed to analyze screen. All models exhausted. Last error: {last_error}"
    except Exception as e:
        return f"Failed to analyze screen. Error: {str(e)}"

def open_application(app_name: str) -> str:
    """
    Attempts to launch a common Windows application by its name.
    Supported apps: notepad, calculator, chrome, edge, explorer, etc.
    """
    app_map = {
        "notepad": "notepad.exe",
        "calculator": "calc.exe",
        "calc": "calc.exe",
        "chrome": "chrome.exe",
        "edge": "msedge.exe",
        "explorer": "explorer.exe",
        "cmd": "cmd.exe",
        "task manager": "taskmgr.exe"
    }
    
    executable = app_map.get(app_name.lower().strip())
    
    if not executable:
        # Fallback: try to just run what they passed
        executable = app_name
        
    try:
        # On Windows, os.startfile is best for documents, but subprocess.Popen works well for exes in PATH
        subprocess.Popen(executable, shell=True)
        return f"Successfully launched {app_name}."
    except Exception as e:
        return f"Failed to launch {app_name}. Error: {str(e)}"

def open_website(url: str) -> str:
    """
    Opens a website URL in the user's default browser.
    """
    try:
        if not url.startswith("http"):
            url = "https://" + url
        webbrowser.open(url)
        return f"Successfully opened website: {url}"
    except Exception as e:
        return f"Failed to open website. Error: {str(e)}"

def get_system_info() -> str:
    """
    Fetches the current CPU usage, RAM usage, and Battery status.
    """
    try:
        cpu_usage = psutil.cpu_percent(interval=0.5)
        
        memory = psutil.virtual_memory()
        ram_usage = memory.percent
        ram_total = round(memory.total / (1024**3), 1)
        ram_used = round(memory.used / (1024**3), 1)
        
        battery = psutil.sensors_battery()
        battery_info = ""
        if battery:
            plugged = "Plugged in" if battery.power_plugged else "Discharging"
            battery_info = f"Battery: {battery.percent}% ({plugged})"
        else:
            battery_info = "Battery: Not detected (Desktop?)"
            
        return (f"System Stats:\n"
                f"- CPU Usage: {cpu_usage}%\n"
                f"- RAM: {ram_usage}% ({ram_used}GB / {ram_total}GB)\n"
                f"- {battery_info}")
    except Exception as e:
        return f"Failed to retrieve system info. Error: {str(e)}"

import pyautogui
import ast
import time
import uiautomation as auto

# Configure PyAutoGUI to be safe
pyautogui.FAILSAFE = True
pyautogui.PAUSE = 0.5

def find_and_click_element(element_description: str) -> str:
    """
    Takes a screenshot, uses Gemini Vision to find the mathematical bounding box of the described UI element,
    converts it to screen pixels, and physically moves the mouse to click it.
    Uses Windows UIAutomation as a lightning-fast primary method before falling back to Vision.
    """
    # 1. Primary Method: Windows UIAutomation (Instant & 100% accurate)
    try:
        window = auto.GetForegroundControl()
        if window:
            # Try exact match
            ctrl = window.Control(searchDepth=7, Name=element_description)
            if ctrl.Exists(0.5, 0.1):
                rect = ctrl.BoundingRectangle
                x, y = (rect.left + rect.right) // 2, (rect.top + rect.bottom) // 2
                pyautogui.moveTo(x, y, duration=0.2)
                pyautogui.click()
                return f"Successfully clicked '{element_description}' via UIAutomation."
                
            # Try partial match
            for c, depth in auto.WalkControl(window, maxDepth=7):
                if c.Name and element_description.lower() in c.Name.lower():
                    rect = c.BoundingRectangle
                    x, y = (rect.left + rect.right) // 2, (rect.top + rect.bottom) // 2
                    pyautogui.moveTo(x, y, duration=0.2)
                    pyautogui.click()
                    return f"Successfully clicked '{c.Name}' via UIAutomation."
    except Exception as e:
        print(f"UIAutomation failed, falling back to Vision: {e}")
        
    # 2. Fallback Method: Gemini Vision Bounding Boxes
    try:
        api_key = os.environ.get("GEMINI_API_KEY")
        if not api_key:
            return "Error: GEMINI_API_KEY is missing."
            
        img = ImageGrab.grab(all_screens=True).convert("RGB")
        width, height = img.size
        
        client = genai.Client(api_key=api_key)
        prompt = f"Find the UI element that matches: '{element_description}'. Return ONLY its bounding box in the exact format [ymin, xmin, ymax, xmax] where values are 0-1000. Do not include any other text."
        contents = [prompt, img]
        models = [
            'gemini-3.1-flash',
            'gemini-3.5-flash',
            'gemini-2.5-flash',
            'gemini-3.1-flash-lite',
            'gemini-3.5-flash-lite'
        ]
        
        last_error = None
        response_text = ""
        for model_name in models:
            try:
                response = client.models.generate_content(
                    model=model_name,
                    contents=contents
                )
                response_text = response.text.strip()
                break
            except Exception as e:
                print(f"[Vision Fallback] {model_name} failed: {e}")
                last_error = e
                
        if not response_text:
            return f"Failed to get bounding box. All models exhausted. Last error: {last_error}"
            
        bbox_str = response_text

        
        if bbox_str.startswith("```"):
            lines = bbox_str.split("\n")
            bbox_str = "".join([l for l in lines if not l.startswith("```")]).strip()
            
        bbox = ast.literal_eval(bbox_str)
        
        if isinstance(bbox, list) and len(bbox) == 4:
            ymin, xmin, ymax, xmax = bbox
            x = int(((xmin + xmax) / 2 / 1000) * width)
            y = int(((ymin + ymax) / 2 / 1000) * height)
            
            pyautogui.moveTo(x, y, duration=0.5)
            time.sleep(0.1)
            pyautogui.click()
            
            return f"Successfully found '{element_description}' via Vision and clicked it at ({x}, {y})."
        else:
            return f"Failed to parse bounding box from vision model: {bbox_str}"
            
    except Exception as e:
        return f"Error executing find_and_click_element: {str(e)}"

def type_text(text: str) -> str:
    """
    Physically types the given text into the currently focused window on the computer using the keyboard.
    """
    try:
        pyautogui.write(text, interval=0.01)
        return f"Successfully typed text: '{text}'"
    except Exception as e:
        return f"Error typing text: {str(e)}"

def press_key(key: str) -> str:
    """
    Presses a specific keyboard key. Valid keys include 'enter', 'tab', 'esc', 'space', 'backspace', 'win', etc.
    """
    try:
        pyautogui.press(key)
        return f"Successfully pressed key: '{key}'"
    except Exception as e:
        return f"Error pressing key: {str(e)}"

def scroll_screen(clicks: int) -> str:
    """
    Scrolls the screen using the mouse wheel. Positive numbers scroll up, negative numbers scroll down.
    Example: -500 to scroll down a bit.
    """
    try:
        pyautogui.scroll(clicks)
        return f"Successfully scrolled screen by {clicks} units."
    except Exception as e:
        return f"Error scrolling screen: {str(e)}"

def move_mouse(x: int, y: int) -> str:
    """
    Moves the mouse to exact absolute pixel coordinates on the screen.
    """
    try:
        pyautogui.moveTo(x, y, duration=0.5)
        return f"Successfully moved mouse to ({x}, {y})."
    except Exception as e:
        return f"Error moving mouse: {str(e)}"

def click_on_screen(button: str = "left") -> str:
    """
    Clicks the mouse at its current location. 'button' can be 'left', 'right', or 'middle'.
    """
    try:
        pyautogui.click(button=button)
        return f"Successfully clicked {button} mouse button."
    except Exception as e:
        return f"Error clicking mouse: {str(e)}"
