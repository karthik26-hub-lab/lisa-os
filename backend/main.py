from fastapi import FastAPI, WebSocket, WebSocketDisconnect
import uvicorn
import json
import asyncio
import pyautogui
import pygetwindow as gw
import pyperclip
import time
import threading
import os
from fastapi.middleware.cors import CORSMiddleware
from pydantic import BaseModel
from brain.llm_client import process_whisperflow, run_memory_agent, STM_BUFFER
from brain import memory_manager
from brain import settings_manager
import datetime
import keyboard
import psutil

STATS_FILE = os.path.join(os.path.dirname(__file__), "brain", "stats.json")

def load_stats():
    if not os.path.exists(STATS_FILE):
        return {"totalWords": 0, "totalChars": 0, "dictationCount": 0}
    try:
        with open(STATS_FILE, "r") as f:
            return json.load(f)
    except:
        return {"totalWords": 0, "totalChars": 0, "dictationCount": 0}

def save_stats(stats):
    with open(STATS_FILE, "w") as f:
        json.dump(stats, f)

HISTORY_FILE = os.path.join(os.path.dirname(__file__), "brain", "history.json")

def load_history_persistent():
    if not os.path.exists(HISTORY_FILE):
        return []
    try:
        with open(HISTORY_FILE, "r") as f:
            return json.load(f)
    except:
        return []

def save_history_persistent(history):
    with open(HISTORY_FILE, "w") as f:
        json.dump(history, f)

last_active_window = None

def track_focus():
    global last_active_window
    while True:
        try:
            win = gw.getActiveWindow()
            if win and win.title and "island" not in win.title.lower() and "aura" not in win.title.lower():
                last_active_window = win
        except:
            pass
        time.sleep(0.1)

threading.Thread(target=track_focus, daemon=True).start()

class SettingsUpdate(BaseModel):
    api_keys: dict[str, str]
    models: dict[str, str] = {}
    active_key_name: str = "gemini"
    theme: str
    processing_mode: str
    global_hotkey: str = "Alt+X"
app = FastAPI(title="WhisperFlow Backend")

app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

class ConnectionManager:
    def __init__(self):
        self.active_connections: list[WebSocket] = []

    async def connect(self, websocket: WebSocket):
        await websocket.accept()
        self.active_connections.append(websocket)
        print("Frontend connected to WhisperFlow Engine.")

    def disconnect(self, websocket: WebSocket):
        if websocket in self.active_connections:
            self.active_connections.remove(websocket)
            print("Frontend disconnected.")

    async def send_personal_message(self, message: str, websocket: WebSocket):
        await websocket.send_text(message)

    async def broadcast(self, message: str):
        for connection in self.active_connections:
            try:
                await connection.send_text(message)
            except:
                pass

manager = ConnectionManager()
loop = None

async def system_stats_loop():
    # Initial call to cpu_percent to initialize
    psutil.cpu_percent(interval=None)
    while True:
        try:
            cpu = psutil.cpu_percent(interval=None)
            ram = psutil.virtual_memory().percent
            battery = psutil.sensors_battery()
            bat_percent = battery.percent if battery else 100
            is_plugged = battery.power_plugged if battery else True
            
            stats = {
                "type": "system_stats",
                "cpu": cpu,
                "ram": ram,
                "battery": bat_percent,
                "plugged": is_plugged
            }
            if manager.active_connections:
                await manager.broadcast(json.dumps(stats))
        except Exception as e:
            pass
        await asyncio.sleep(2)

current_hotkey = "alt+x"

@app.on_event("startup")
async def startup_event():
    global loop, current_hotkey
    loop = asyncio.get_running_loop()
    current_hotkey = settings_manager.load_settings().get("global_hotkey", "Alt+X").lower()
    asyncio.create_task(system_stats_loop())

def get_context():
    """
    Grabs the active window title and the currently selected text (via Ctrl+C).
    """
    context = {
        "active_window": "Unknown",
        "selected_text": ""
    }
    try:
        window = gw.getActiveWindow()
        if window:
            context["active_window"] = window.title
            
            # Save current clipboard
            old_clip = pyperclip.paste()
            
            # Clear clipboard and copy
            pyperclip.copy("")
            pyautogui.hotkey('ctrl', 'c')
            time.sleep(0.1)
            
            selected = pyperclip.paste().strip()
            
            if selected:
                context["selected_text"] = selected
            
            # Restore old clipboard if we didn't grab anything new, 
            # or just leave the selected text there if we did.
            if not selected and old_clip:
                pyperclip.copy(old_clip)
                
    except Exception as e:
        print(f"Error capturing context: {e}")
        
    return context

@app.websocket("/ws/lisa")
async def websocket_endpoint(websocket: WebSocket):
    await manager.connect(websocket)
    try:
        while True:
            msg = await websocket.receive_text()
            msg_type = "dictation"
            try:
                data = json.loads(msg)
                if data.get("type") == "text_polish":
                    msg_type = "text_polish"
                    source = "global"
                else:
                    raw_data = data.get("text", "")
                    source = data.get("source", "global")
            except:
                raw_data = msg
                source = "global"

            # Grab OS Context
            app_context = get_context()

            if msg_type == "text_polish":
                raw_data = app_context.get("selected_text", "")
                if not raw_data:
                    await manager.send_personal_message(json.dumps({"type": "chat_result", "content": "[No text selected]", "source": "global"}), websocket)
                    continue
                print(f"Executing Text Polish on: {raw_data}")
            else:
                print(f"Received raw dictation from {source}: {raw_data}")
            
            # Send acknowledgement to UI
            await manager.send_personal_message(json.dumps({"type": "message", "content": "Polishing..."}), websocket)

            
            # Pass through the LLM for polishing
            polished_text = process_whisperflow(raw_data, app_context)
            print(f"Polished dictation: {polished_text}")
            
            # Update Persistent Stats
            stats = load_stats()
            stats["totalWords"] += len(polished_text.split())
            stats["totalChars"] += len(polished_text)
            stats["dictationCount"] += 1
            save_stats(stats)
            
            # Update Persistent History
            phist = load_history_persistent()
            phist.append({
                "raw": raw_data,
                "polished": polished_text,
                "timestamp": time.time()
            })
            if len(phist) > 200:
                phist = phist[-200:]
            save_history_persistent(phist)
            
            # Broadcast to all clients (Dashboard) that stats have updated
            await manager.broadcast(json.dumps({"type": "stats_updated"}))
            
            # Instantly type the polished text into the active window
            # Only attempt to restore focus if the Lisa UI currently has focus
            current_win = gw.getActiveWindow()
            if current_win and ("lisa flow" in current_win.title.lower() or "island" in current_win.title.lower() or "aura" in current_win.title.lower()):
                if last_active_window:
                    try:
                        last_active_window.activate()
                        time.sleep(0.2)
                    except Exception as e:
                        print(f"Could not activate window: {e}")
            
            # Save original clipboard
            old_clipboard = pyperclip.paste()

            # Type the text safely without triggering 'Send' in chat apps
            safe_text = polished_text.replace('\r', '')
            lines = safe_text.split('\n')
            for i, line in enumerate(lines):
                if line:
                    pyperclip.copy(line)
                    time.sleep(0.05) # Wait for OS clipboard to update
                    pyautogui.hotkey('ctrl', 'v')
                    time.sleep(0.05) # Wait for paste to register
                if i < len(lines) - 1:
                    pyautogui.hotkey('shift', 'enter')
                    
            # Restore clipboard
            time.sleep(0.1)
            try:
                pyperclip.copy(old_clipboard)
            except:
                pass
            
            # Send final status back to UI
            await manager.send_personal_message(json.dumps({
                "type": "message", 
                "content": f"Typed: {polished_text[:20]}..." if len(polished_text) > 20 else f"Typed: {polished_text}"
            }), websocket)
            
            # Spawn background memory agent to analyze and store long-term context
            asyncio.create_task(run_memory_agent(raw_data, polished_text))
            
    except WebSocketDisconnect:
        manager.disconnect(websocket)

@app.get("/health")
def health_check():
    return {"status": "WhisperFlow Core is running"}

@app.get("/api/settings")
def get_settings():
    return settings_manager.load_settings()

@app.post("/api/settings")
def update_settings(settings: SettingsUpdate):
    settings_manager.save_settings(settings.dict())
    global current_hotkey
    current_hotkey = settings.global_hotkey.lower()
    return {"status": "success"}

@app.get("/api/memory")
def get_memory():
    return memory_manager.get_raw_memory()

@app.delete("/api/memory/{category}/{key}")
def delete_memory(category: str, key: str):
    success = memory_manager.delete_memory(category, key)
    if success:
        return {"status": "success"}
    return {"status": "error", "message": "Memory not found"}, 404

@app.get("/api/history")
def get_history():
    import datetime
    history = []
    history_data = load_history_persistent()
    for turn in reversed(history_data):
        timestamp = turn.get("timestamp")
        time_str = "Just now"
        if timestamp:
            dt = datetime.datetime.fromtimestamp(timestamp)
            time_str = dt.strftime("%I:%M %p")
            
        history.append({
            "title": "Dictation",
            "desc": turn["polished"],
            "time": time_str,
            "timestamp": timestamp
        })
    return history

@app.delete("/api/history/{timestamp}")
def delete_history_item(timestamp: float):
    history_data = load_history_persistent()
    history_data = [item for item in history_data if str(item.get("timestamp")) != str(timestamp)]
    save_history_persistent(history_data)
    return {"status": "success"}

@app.delete("/api/history")
def clear_history():
    save_history_persistent([])
    try:
        from brain.llm_client import STM_BUFFER
        STM_BUFFER.clear()
    except:
        pass
    return {"status": "success"}

@app.get("/api/stats")
def get_stats():
    stats = load_stats()
    total_words = stats.get("totalWords", 0)
    
    # Estimate time saved: Typing speed avg ~40 WPM vs Dictation ~120 WPM
    # Time saved = (Words / 40) - (Words / 120) minutes
    if total_words > 0:
        time_saved_mins = (total_words / 40.0) - (total_words / 120.0)
        
        # Format time saved nicely
        if time_saved_mins < 1:
            time_saved_str = f"{int(time_saved_mins * 60)}s"
        elif time_saved_mins < 60:
            time_saved_str = f"{int(time_saved_mins)}m"
        else:
            time_saved_str = f"{int(time_saved_mins // 60)}h {int(time_saved_mins % 60)}m"
    else:
        time_saved_str = "0m"
        
    # Format total words (e.g. 1.2k)
    if total_words > 999:
        total_words_str = f"{total_words/1000:.1f}k"
    else:
        total_words_str = str(total_words)
        
    return {
        "totalWords": total_words_str,
        "timeSaved": time_saved_str,
        "dictationCount": stats.get("dictationCount", 0)
    }

if __name__ == "__main__":
    uvicorn.run("main:app", host="127.0.0.1", port=8000, reload=False)
