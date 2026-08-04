from fastapi import FastAPI, WebSocket, WebSocketDisconnect
import uvicorn
import json
import threading
import queue
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
                continue
            if "hide the text" in lower_data or "close text" in lower_data:
                await manager.send_personal_message(json.dumps({"type": "ui_action", "action": "hide_text"}), websocket)
                await manager.send_personal_message(json.dumps({"type": "message", "content": "Text box hidden."}), websocket)
                continue
            if "open convo history" in lower_data or "show history" in lower_data or "open history" in lower_data:
                await manager.send_personal_message(json.dumps({"type": "ui_action", "action": "show_history"}), websocket)
                await manager.send_personal_message(json.dumps({"type": "message", "content": "History opened."}), websocket)
                continue
            if "close convo history" in lower_data or "hide history" in lower_data or "close history" in lower_data:
                await manager.send_personal_message(json.dumps({"type": "ui_action", "action": "hide_history"}), websocket)
                await manager.send_personal_message(json.dumps({"type": "message", "content": "History closed."}), websocket)
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
                else:
                    await manager.send_personal_message(json.dumps({"type": "message", "content": "Scanning screen for text..."}), websocket)
                    
                    # Run vision fallback in a separate thread so we don't block the websocket
                    def vision_read_worker(ws_manager, ws):
                        import asyncio
                        try:
                            result = analyze_screen("Please read the main text visible on the screen. Do not describe the screen or UI elements, just extract and read the main content aloud as if you are a screen reader.")
                            # Send result back via an event loop
                            loop = asyncio.new_event_loop()
                            asyncio.set_event_loop(loop)
                            loop.run_until_complete(ws_manager.send_personal_message(json.dumps({"type": "message", "content": f"*Screen Text:* {result}"}), ws))
                        except Exception as e:
                            print("Vision read failed:", e)
                            
                    import threading
                    threading.Thread(target=vision_read_worker, args=(manager, websocket), daemon=True).start()
                continue

            # Send immediate acknowledgement for normal queries
            await manager.send_personal_message(json.dumps({"type": "message", "content": "Thinking..."}), websocket)
            
            # Process via Cognitive Engine (Synchronously for now, can be async later)
            ai_response = process_message(data)
            
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
