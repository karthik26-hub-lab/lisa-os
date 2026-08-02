from fastapi import FastAPI, WebSocket, WebSocketDisconnect
import uvicorn
import json
import threading
import queue
import pyttsx3
import re
from brain.router import process_message

app = FastAPI(title="LISA OS Core Engine")

# TTS Worker Thread (Avoids blocking FastAPI)
tts_queue = queue.Queue()

def tts_worker():
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
        engine.say(clean_text)
        engine.runAndWait()
        tts_queue.task_done()

threading.Thread(target=tts_worker, daemon=True).start()

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

if __name__ == "__main__":
    uvicorn.run("main:app", host="127.0.0.1", port=8000, reload=True)
