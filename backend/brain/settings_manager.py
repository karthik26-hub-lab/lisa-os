import json
import os
from pathlib import Path
from dotenv import load_dotenv

SETTINGS_FILE = Path(__file__).parent.parent / "settings.json"

def load_settings():
    if not SETTINGS_FILE.exists():
        # Fallback to .env initially
        api_key = os.environ.get("GEMINI_API_KEY", "")
        default_settings = {
            "api_keys": {"gemini": api_key} if api_key else {}, 
            "models": {},
            "active_key_name": "gemini",
            "theme": "light", 
            "processing_mode": "Grammar Correction",
            "global_hotkey": "Alt+X"
        }
        save_settings(default_settings)
        return default_settings
    
    with open(SETTINGS_FILE, "r") as f:
        settings = json.load(f)
        
    # Legacy migration
    modified = False
    if "api_key" in settings:
        if "api_keys" not in settings:
            settings["api_keys"] = {}
        if settings["api_key"]:
            settings["api_keys"]["gemini"] = settings["api_key"]
        del settings["api_key"]
        modified = True
        
    if "models" not in settings:
        settings["models"] = {}
        modified = True
        
    if "active_key_name" not in settings:
        settings["active_key_name"] = "gemini"
        modified = True
        
    if "processing_mode" not in settings:
        settings["processing_mode"] = "Grammar Correction"
        modified = True
        
    if "global_hotkey" not in settings:
        settings["global_hotkey"] = "Alt+X"
        modified = True
        
    if modified:
        save_settings(settings)
        
    return settings

def save_settings(settings):
    with open(SETTINGS_FILE, "w") as f:
        json.dump(settings, f, indent=4)

def get_key(provider: str) -> str:
    key = load_settings().get("api_keys", {}).get(provider, "")
    if not key and provider == "gemini":
        load_dotenv()
        return os.environ.get("GEMINI_API_KEY", "")
    return key

def get_api_key():
    settings = load_settings()
    active = settings.get("active_key_name", "gemini")
    return get_key(active)
