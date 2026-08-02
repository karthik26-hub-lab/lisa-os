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
        response = client.models.generate_content(
            model='gemini-3.1-flash',
            contents=[f"Look at this screenshot of my screen and answer: {query}", img]
        )
        return response.text
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
