import { useState, useEffect, useRef } from "react";
import ReactMarkdown from "react-markdown";
import "./App.css";

// Global interface for Web Speech API
declare global {
  interface Window {
    webkitSpeechRecognition: any;
  }
}

type Message = { role: 'user' | 'ai', content: string };

function App() {
  const [status, setStatus] = useState("disconnected");
  const [isListening, setIsListening] = useState(false);
  const [messages, setMessages] = useState<Message[]>([]);
  const ws = useRef<WebSocket | null>(null);
  const recognition = useRef<any>(null);

  useEffect(() => {
    // Connect to Python Backend
    ws.current = new WebSocket("ws://127.0.0.1:8000/ws/lisa");

    ws.current.onopen = () => setStatus("connected");
    ws.current.onclose = () => setStatus("disconnected");
    ws.current.onerror = (error) => console.error("WebSocket error:", error);

    ws.current.onmessage = (event) => {
      const data = JSON.parse(event.data);
      if (data.type === "message") {
        setMessages((prev) => [...prev, { role: 'ai', content: data.content }]);
      }
    };

    // Initialize Web Speech API
    if ('webkitSpeechRecognition' in window) {
      const SpeechRecognition = window.webkitSpeechRecognition;
      recognition.current = new SpeechRecognition();
      recognition.current.continuous = true; // Keeps listening until manually stopped
      recognition.current.interimResults = true;
      recognition.current.lang = 'en-US';

      // We use a ref to accumulate the transcript without triggering re-renders on every word
      const transcriptRef = { current: "" };

      recognition.current.onstart = () => {
        setIsListening(true);
        transcriptRef.current = ""; // Clear previous
      };

      recognition.current.onresult = (event: any) => {
        let current = "";
        for (let i = 0; i < event.results.length; i++) {
          current += event.results[i][0].transcript;
        }
        transcriptRef.current = current;
      };

      recognition.current.onerror = (event: any) => {
        console.error("Speech recognition error", event.error);
        setIsListening(false);
      };

      recognition.current.onend = () => {
        setIsListening(false);
        const finalStr = transcriptRef.current.trim();
        if (finalStr) {
          setMessages((prev) => [...prev, { role: 'user', content: finalStr }]);
          // Send transcribed text to backend
          if (ws.current && ws.current.readyState === WebSocket.OPEN) {
            ws.current.send(finalStr);
          }
        }
      };
    } else {
      console.warn("Speech Recognition API not supported in this environment.");
    }

    return () => {
      ws.current?.close();
      if (recognition.current) {
        recognition.current.stop();
      }
    };
  }, []);

  const handleOrbClick = () => {
    if (isListening) {
      recognition.current?.stop();
    } else {
      recognition.current?.start();
    }
  };

  return (
    <div className="lisa-container" data-tauri-drag-region>
      <div 
        className={`siri-ribbon ${status === 'connected' ? 'active' : 'inactive'} ${isListening ? 'listening' : ''}`} 
        onClick={handleOrbClick} 
        data-tauri-drag-region
      >
        <div className="ribbon-glow" data-tauri-drag-region></div>
      </div>
      <div className="status-text" data-tauri-drag-region>
        {isListening ? "Listening..." : (status === "connected" ? "LISA Online" : "Connecting...")}
      </div>
      
      <div className="message-log">
        {messages.slice(-3).map((msg, i) => (
          <div key={i} className={`message ${msg.role === 'user' ? 'user-msg' : 'ai-msg'}`}>
             {msg.role === 'user' ? msg.content : <ReactMarkdown>{msg.content}</ReactMarkdown>}
          </div>
        ))}
      </div>
    </div>
  );
}

export default App;
