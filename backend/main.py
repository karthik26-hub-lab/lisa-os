from fastapi import FastAPI, WebSocket, WebSocketDisconnect
import uvicorn
import json
from brain.router import process_message

app = FastAPI(title="LISA OS Core Engine")

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
            
            # Send immediate acknowledgement
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

if __name__ == "__main__":
    uvicorn.run("main:app", host="127.0.0.1", port=8000, reload=True)
