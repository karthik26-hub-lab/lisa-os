from fastapi import FastAPI, WebSocket, WebSocketDisconnect
import uvicorn
import json
import threading
import queue
import pyttsx3
import re
from brain.router import process_message

from fastapi.middleware.cors import CORSMiddleware
import os

app = FastAPI(title="LISA OS Core Engine")

app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

import asyncio

main_loop = None

@app.on_event("startup")
async def startup_event():
    global main_loop
    main_loop = asyncio.get_running_loop()

# TTS Worker Thread (Avoids blocking FastAPI)
tts_queue = queue.Queue()

def tts_worker(manager):
    engine = pyttsx3.init()
    # Configure Voice (Try to find a female voice like Zira)
    voices = engine.getProperty('voices')
    for voice in voices:
        if "Zira" in voice.name or "Female" in voice.name:
            engine.setProperty('voice', voice.id)
            break
            
    # Adjust speech rate slightly for a more natural feel
    rate = engine.getProperty('rate')
    engine.setProperty('rate', rate - 15)

    while True:
        text = tts_queue.get()
        if text is None:
            break
        # Clean markdown symbols for cleaner speech
        clean_text = re.sub(r'[*#`_]', '', text)
        
        global main_loop
        if main_loop and main_loop.is_running():
            asyncio.run_coroutine_threadsafe(manager.broadcast(json.dumps({"type": "ui_action", "action": "speaking_start"})), main_loop)
            
        engine.say(clean_text)
        engine.runAndWait()
        
        if main_loop and main_loop.is_running():
            asyncio.run_coroutine_threadsafe(manager.broadcast(json.dumps({"type": "ui_action", "action": "speaking_stop"})), main_loop)
            
        tts_queue.task_done()

class ConnectionManager:
    def __init__(self):
        self.active_connections: list[WebSocket] = []

    async def connect(self, websocket: WebSocket):
        await websocket.accept()
        self.active_connections.append(websocket)
        print("Frontend connected to Cognitive Engine.")

    def disconnect(self, websocket: WebSocket):
        if websocket in self.active_connections:
            self.active_connections.remove(websocket)
            print("Frontend disconnected.")

    async def send_personal_message(self, message: str, websocket: WebSocket):
        await websocket.send_text(message)

    async def broadcast(self, message: str):
        for connection in self.active_connections:
            await connection.send_text(message)

manager = ConnectionManager()

# Start TTS worker with manager
import threading
threading.Thread(target=tts_worker, args=(manager,), daemon=True).start()

@app.websocket("/ws/lisa")
async def websocket_endpoint(websocket: WebSocket):
    await manager.connect(websocket)
    try:
        while True:
            data = await websocket.receive_text()
            print(f"Received from frontend: {data}")
            
            # Fast Dictation Mode Intercept
            import re
            dictation_match = re.match(r'^type\s+(.*)', data, re.IGNORECASE | re.DOTALL)
            if dictation_match:
                text_to_type = dictation_match.group(1).strip()
                import pyautogui
                # Type the text immediately bypassing the LLM
                pyautogui.write(text_to_type, interval=0.01)
                
                # Send a small confirmation to the UI without TTS
                response = {
                    "type": "message",
                    "content": f"*Dictated:* {text_to_type}"
                }
                await manager.send_personal_message(json.dumps(response), websocket)
                continue
            
            # UI Voice Intercepts
            lower_data = data.lower().strip()
            if "show the text" in lower_data or "open text" in lower_data:
                await manager.send_personal_message(json.dumps({"type": "ui_action", "action": "show_text"}), websocket)
                await manager.send_personal_message(json.dumps({"type": "message", "content": "Text box opened."}), websocket)
                tts_queue.put("I have opened the text box.")
                continue
            if "hide the text" in lower_data or "close text" in lower_data:
                await manager.send_personal_message(json.dumps({"type": "ui_action", "action": "hide_text"}), websocket)
                await manager.send_personal_message(json.dumps({"type": "message", "content": "Text box hidden."}), websocket)
                tts_queue.put("I have hidden the text box.")
                continue
            if "open convo history" in lower_data or "show history" in lower_data or "open history" in lower_data:
                await manager.send_personal_message(json.dumps({"type": "ui_action", "action": "show_history"}), websocket)
                await manager.send_personal_message(json.dumps({"type": "message", "content": "History opened."}), websocket)
                tts_queue.put("I have opened the conversation history.")
                continue
            if "close convo history" in lower_data or "hide history" in lower_data or "close history" in lower_data:
                await manager.send_personal_message(json.dumps({"type": "ui_action", "action": "hide_history"}), websocket)
                await manager.send_personal_message(json.dumps({"type": "message", "content": "History closed."}), websocket)
                tts_queue.put("I have closed the history panel.")
                continue

            # Fast Read Intercept (Read selected text or screen)
            if lower_data in ["read", "speak", "sollu", "vaasi", "read it", "padichi kaatu"]:
                import pyautogui
                import time
                import subprocess
                from brain.tools import analyze_screen
                
                # Clear clipboard first
                subprocess.run(['powershell', '-command', 'Set-Clipboard -Value $null'])
                
                # Try to copy selected text
                pyautogui.hotkey('ctrl', 'c')
                time.sleep(0.1) # Wait for clipboard to populate
                
                try:
                    selected_text = subprocess.check_output(['powershell', '-command', 'Get-Clipboard'], text=True, stderr=subprocess.DEVNULL).strip()
                except:
                    selected_text = ""
                    
                if selected_text:
                    await manager.send_personal_message(json.dumps({"type": "message", "content": f"*Reading selection:* {selected_text}"}), websocket)
                    tts_queue.put(selected_text)
                else:
                    await manager.send_personal_message(json.dumps({"type": "message", "content": "Scanning screen for text..."}), websocket)
                    tts_queue.put("Scanning screen for text.")
                    
                    # Run vision fallback in a separate thread so we don't block the websocket
                    def vision_read_worker(ws_manager, ws, t_queue):
                        import asyncio
                        try:
                            result = analyze_screen("Please read the main text visible on the screen. Do not describe the screen or UI elements, just extract and read the main content aloud as if you are a screen reader.")
                            # Send result back via an event loop
                            loop = asyncio.new_event_loop()
                            asyncio.set_event_loop(loop)
                            loop.run_until_complete(ws_manager.send_personal_message(json.dumps({"type": "message", "content": f"*Screen Text:* {result}"}), ws))
                            t_queue.put(result)
                        except Exception as e:
                            print("Vision read failed:", e)
                            
                    threading.Thread(target=vision_read_worker, args=(manager, websocket, tts_queue), daemon=True).start()
                continue

            # Send immediate acknowledgement for normal queries
            await manager.send_personal_message(json.dumps({"type": "message", "content": "Thinking..."}), websocket)
            
            # Process via Cognitive Engine (Synchronously for now, can be async later)
            ai_response = process_message(data)
            
            # Trigger Backend TTS
            tts_queue.put(ai_response)
            
            response = {
                "type": "message",
                "content": ai_response
            }
            await manager.send_personal_message(json.dumps(response), websocket)
            
    except WebSocketDisconnect:
        manager.disconnect(websocket)

@app.get("/health")
def health_check():
    return {"status": "LISA OS Core is running"}

@app.get("/history")
def get_history():
    history_file = os.path.join(os.path.dirname(__file__), 'brain', 'chat_history.json')
    if os.path.exists(history_file):
        try:
            with open(history_file, 'r', encoding='utf-8') as f:
                data = json.load(f)
                if isinstance(data, list):
                    return {"legacy_session": {"title": "Legacy Session", "messages": data}}
                return data
        except:
            return {}
    return {}

if __name__ == "__main__":
    uvicorn.run("main:app", host="127.0.0.1", port=8000, reload=True)
