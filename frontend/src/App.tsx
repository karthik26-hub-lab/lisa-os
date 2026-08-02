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
        if (data.content === "Thinking...") {
          setMessages((prev) => [...prev, { role: 'ai', content: data.content }]);
        } else {
          setMessages((prev) => {
            const filtered = prev.filter(msg => msg.content !== "Thinking...");
            return [...filtered, { role: 'ai', content: data.content }];
          });
        }
      }
    };

    // Initialize Web Speech API
    if ('webkitSpeechRecognition' in window) {
      const SpeechRecognition = window.webkitSpeechRecognition;
      recognition.current = new SpeechRecognition();
      recognition.current.continuous = true;
      recognition.current.interimResults = true;
      recognition.current.lang = 'en-US';

      // We use a ref to accumulate the transcript
      const transcriptRef = { current: "" };
      const residualRef = { current: "" };
      let silenceTimer: any = null;

      // To handle passing residual text from the wake word listener
      (window as any).initialTranscriptText = "";

      recognition.current.onstart = () => {
        setIsListening(true);
        residualRef.current = (window as any).initialTranscriptText || "";
        transcriptRef.current = residualRef.current;
        (window as any).initialTranscriptText = ""; // clear after seeding
        
        if (silenceTimer) clearTimeout(silenceTimer);
      };

      recognition.current.onresult = (event: any) => {
        let current = residualRef.current ? residualRef.current + " " : "";
        for (let i = 0; i < event.results.length; i++) {
          current += event.results[i][0].transcript;
        }
        transcriptRef.current = current;
        
        // 3-second silence timeout
        if (silenceTimer) clearTimeout(silenceTimer);
        silenceTimer = setTimeout(() => {
            console.log("3 seconds of silence detected. Auto-sending...");
            if (recognition.current) recognition.current.stop();
        }, 3000);
      };

      recognition.current.onerror = (event: any) => {
        console.error("Speech recognition error", event.error);
        setIsListening(false);
      };

      recognition.current.onend = () => {
        setIsListening(false);
        if (silenceTimer) clearTimeout(silenceTimer);
        const finalStr = transcriptRef.current.trim();
        if (finalStr) {
          setMessages((prev) => [...prev, { role: 'user', content: finalStr }]);
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

  // Wake Word Listener
  useEffect(() => {
    let wakeWordRecognition: any = null;
    let isWakeWordActive = true;
    let isTransitioning = false;

    if ('webkitSpeechRecognition' in window) {
      wakeWordRecognition = new (window as any).webkitSpeechRecognition();
      wakeWordRecognition.continuous = true;
      wakeWordRecognition.interimResults = true;
      
      wakeWordRecognition.onresult = (event: any) => {
        if (!isListening && status === 'connected' && !isTransitioning) {
          let transcript = '';
          for (let i = event.resultIndex; i < event.results.length; ++i) {
            transcript += event.results[i][0].transcript;
          }
          
          const lower = transcript.toLowerCase();
          const matchRegex = /\b(?:hey lisa|hello lisa|ok lisa|lisa)\b\s*(.*)/i;
          const match = lower.match(matchRegex);
          
          if (match) {
            console.log("Wake word detected!");
            isTransitioning = true;
            setIsListening(true);
            wakeWordRecognition.stop();
            
            // Pass any trailing command text to the main listener
            const residualCommand = match[1].trim();
            if (residualCommand) {
              (window as any).initialTranscriptText = residualCommand;
            }
            
            try { recognition.current?.start(); } catch (e) { console.error(e); }
          }
        }
      };
      
      wakeWordRecognition.onend = () => {
        if (!isTransitioning && isWakeWordActive && !isListening && status === 'connected') {
           try { wakeWordRecognition.start(); } catch(e) {}
        }
      };
      
      if (!isListening && status === 'connected') {
        try { wakeWordRecognition.start(); } catch(e) {}
      }
    }

    return () => {
      isWakeWordActive = false;
      if (wakeWordRecognition) {
        try { wakeWordRecognition.stop(); } catch(e) {}
      }
    };
  }, [isListening, status]);

  const handleOrbClick = () => {
    if (isListening) {
      recognition.current?.stop();
    } else {
      (window as any).initialTranscriptText = "";
      recognition.current?.start();
    }
  };

  return (
    <div className="lisa-container" data-tauri-drag-region>
      <div 
        className={`siri-orb ${status === 'connected' ? 'active' : 'inactive'} ${isListening ? 'listening' : ''}`} 
        onClick={handleOrbClick} 
        data-tauri-drag-region
      >
      </div>
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
