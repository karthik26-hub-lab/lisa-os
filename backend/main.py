from fastapi import FastAPI, WebSocket, WebSocketDisconnect
import uvicorn
import json
import asyncio
import pyautogui
import pygetwindow as gw
import pyperclip
import time
import threading
from fastapi.middleware.cors import CORSMiddleware
from pydantic import BaseModel
from brain.llm_client import process_whisperflow, run_memory_agent, STM_BUFFER
from brain import settings_manager
import keyboard

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
    theme: str
    processing_mode: str
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

manager = ConnectionManager()
loop = None

@app.on_event("startup")
async def startup_event():
    global loop
    loop = asyncio.get_running_loop()
    
    def on_hotkey():
        if loop and manager.active_connections:
            for ws in manager.active_connections:
                asyncio.run_coroutine_threadsafe(
                    manager.send_personal_message(json.dumps({"type": "toggle_mic"}), ws),
                    loop
                )
                
    keyboard.add_hotkey('alt+x', on_hotkey)
    keyboard.add_hotkey('ctrl+shift+k', on_hotkey)

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
            raw_data = await websocket.receive_text()
            print(f"Received raw dictation: {raw_data}")
            
            # Send acknowledgement to UI
            await manager.send_personal_message(json.dumps({"type": "message", "content": "Polishing..."}), websocket)
            
            # Grab OS Context
            app_context = get_context()
            
            # Pass through the LLM for polishing
            polished_text = process_whisperflow(raw_data, app_context)
            print(f"Polished dictation: {polished_text}")
            
            # Instantly type the polished text into the active window
            # Restore focus to the last real application if we clicked the Island
            if last_active_window:
                try:
                    last_active_window.activate()
                    time.sleep(0.2)
                except Exception as e:
                    print(f"Could not activate window: {e}")
            
            # Type the text
            pyautogui.write(polished_text, interval=0.005)
            
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
    return {"status": "success"}

@app.get("/api/history")
def get_history():
    import datetime
    history = []
    for turn in reversed(STM_BUFFER):
        timestamp = turn.get("timestamp")
        time_str = "Just now"
        if timestamp:
            dt = datetime.datetime.fromtimestamp(timestamp)
            time_str = dt.strftime("%I:%M %p")
            
        history.append({
            "title": "Dictation",
            "desc": turn["polished"],
            "time": time_str
        })
    return history

@app.delete("/api/history")
def clear_history():
    STM_BUFFER.clear()
    return {"status": "success"}

@app.get("/api/stats")
def get_stats():
    total_words = 0
    total_chars = 0
    for turn in STM_BUFFER:
        text = turn["polished"]
        total_words += len(text.split())
        total_chars += len(text)
        
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
        "dictationCount": len(STM_BUFFER)
    }

if __name__ == "__main__":
    uvicorn.run("main:app", host="127.0.0.1", port=8000, reload=False)
