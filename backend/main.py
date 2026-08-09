from fastapi import FastAPI, WebSocket, WebSocketDisconnect
import uvicorn
import json
import pyautogui
import pygetwindow as gw
import pyperclip
import time
from fastapi.middleware.cors import CORSMiddleware
from brain.llm_client import process_whisperflow

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
            # Small delay to ensure the OS has focus back on the target window
            time.sleep(0.1)
            pyautogui.write(polished_text, interval=0.005)
            
            # Send final status back to UI
            await manager.send_personal_message(json.dumps({
                "type": "message", 
                "content": f"Typed: {polished_text[:20]}..." if len(polished_text) > 20 else f"Typed: {polished_text}"
            }), websocket)
            
    except WebSocketDisconnect:
        manager.disconnect(websocket)

@app.get("/health")
def health_check():
    return {"status": "WhisperFlow Core is running"}

if __name__ == "__main__":
    uvicorn.run("main:app", host="127.0.0.1", port=8000, reload=True)
