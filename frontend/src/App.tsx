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
      {isListening ? (
        <div 
          className="siri-waves-container listening" 
          onClick={handleOrbClick} 
          data-tauri-drag-region
        >
          <svg viewBox="0 0 400 100" className="siri-svg" preserveAspectRatio="none">
            <path className="wave wave3" d="M0,50 Q12.5,80 25,50 T50,50 T75,50 T100,50 T125,50 T150,50 T175,50 T200,50 T225,50 T250,50 T275,50 T300,50 T325,50 T350,50 T375,50 T400,50" />
            <path className="wave wave1" d="M0,50 Q25,10 50,50 T100,50 T150,50 T200,50 T250,50 T300,50 T350,50 T400,50" />
            <path className="wave wave2" d="M0,50 Q50,90 100,50 T200,50 T300,50 T400,50" />
            <path className="wave wave-core" d="M0,50 L400,50" />
          </svg>
        </div>
      ) : (
        <div 
          className={`siri-orb ${status === 'connected' ? 'active' : 'inactive'}`} 
          onClick={handleOrbClick} 
          data-tauri-drag-region
        >
          <div className="orb-core" data-tauri-drag-region></div>
        </div>
      )}
      <div className="status-text" data-tauri-drag-region>
        {isListening ? "Listening..." : (status === "connected" ? "LISA Online" : "Connecting...")}
      </div>
      
      {messages.length > 0 && (
        <div className="message-log" data-tauri-drag-region>
          {messages.map((msg, i) => (
            <div key={i} className={`message ${msg.role === 'user' ? 'user-msg' : 'ai-msg'}`}>
               {msg.role === 'user' ? msg.content : <ReactMarkdown>{msg.content}</ReactMarkdown>}
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

export default App;
