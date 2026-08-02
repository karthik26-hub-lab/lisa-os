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
  
  const mainRec = useRef<any>(null);
  const wakeRec = useRef<any>(null);
  
  const silenceTimer = useRef<any>(null);
  const transcriptRef = useRef<string>("");
  const residualRef = useRef<string>("");
  
  // State refs to avoid stale closures in event listeners
  const isListeningRef = useRef(false);
  const statusRef = useRef("disconnected");
  const isTransitioningRef = useRef(false);

  // Sync state to refs
  useEffect(() => {
    isListeningRef.current = isListening;
  }, [isListening]);

  useEffect(() => {
    statusRef.current = status;
  }, [status]);

  // Initialize WebSocket
  useEffect(() => {
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
    
    return () => ws.current?.close();
  }, []);

  // Initialize Speech Recognition Instances (ONCE)
  useEffect(() => {
    if (!('webkitSpeechRecognition' in window)) {
      console.warn("Speech Recognition API not supported.");
      return;
    }

    const SpeechRecognition = window.webkitSpeechRecognition;
    
    // Create instances
    mainRec.current = new SpeechRecognition();
    mainRec.current.continuous = true;
    mainRec.current.interimResults = true;
    mainRec.current.lang = 'en-US';

    wakeRec.current = new SpeechRecognition();
    wakeRec.current.continuous = true;
    wakeRec.current.interimResults = true;
    wakeRec.current.lang = 'en-US';

    // --- MAIN REC LOGIC ---
    mainRec.current.onstart = () => {
      console.log("Main rec started.");
      setIsListening(true);
      isTransitioningRef.current = false;
      
      transcriptRef.current = residualRef.current;
      residualRef.current = "";
      
      if (silenceTimer.current) clearTimeout(silenceTimer.current);
      silenceTimer.current = setTimeout(() => {
        console.log("Silence timeout in main rec (onstart). Stopping.");
        if (mainRec.current) mainRec.current.stop();
      }, 3000);
    };

    mainRec.current.onresult = (event: any) => {
      let currentTranscript = transcriptRef.current; // start with residual
      
      // We must reconstruct the string carefully
      let liveText = "";
      for (let i = 0; i < event.results.length; i++) {
         liveText += event.results[i][0].transcript;
      }
      
      // If we had residual text, prepend it to the live text
      if (residualRef.current) {
          transcriptRef.current = residualRef.current + " " + liveText;
      } else {
          transcriptRef.current = liveText;
      }
      
      if (silenceTimer.current) clearTimeout(silenceTimer.current);
      silenceTimer.current = setTimeout(() => {
        console.log("Silence timeout in main rec (onresult). Stopping.");
        if (mainRec.current) mainRec.current.stop();
      }, 3000);
    };

    mainRec.current.onerror = (event: any) => {
      console.error("Main rec error:", event.error);
      setIsListening(false);
    };

    mainRec.current.onend = () => {
      console.log("Main rec ended.");
      setIsListening(false);
      if (silenceTimer.current) clearTimeout(silenceTimer.current);
      
      const finalStr = transcriptRef.current.trim();
      if (finalStr) {
        setMessages((prev) => [...prev, { role: 'user', content: finalStr }]);
        if (ws.current && ws.current.readyState === WebSocket.OPEN) {
          ws.current.send(finalStr);
        }
      }
      transcriptRef.current = "";
      residualRef.current = "";
    };

    // --- WAKE REC LOGIC ---
    wakeRec.current.onstart = () => {
      console.log("Wake rec started.");
    };

    wakeRec.current.onerror = (event: any) => {
      console.warn("Wake rec error:", event.error);
    };

    wakeRec.current.onresult = (event: any) => {
      if (isTransitioningRef.current || isListeningRef.current) return;
      
      let currentTranscript = "";
      for (let i = event.resultIndex; i < event.results.length; ++i) {
        currentTranscript += event.results[i][0].transcript;
      }
      
      const lower = currentTranscript.toLowerCase();
      // Match "lisa", "hey lisa", etc.
      const matchRegex = /\b(?:hey[\s,]*lisa|hello[\s,]*lisa|ok[\s,]*lisa|lisa)\b\s*(.*)/i;
      const match = lower.match(matchRegex);
      
      if (match) {
        console.log("Wake word detected! Transitioning...");
        isTransitioningRef.current = true;
        
        const residual = match[1].trim();
        if (residual) {
          residualRef.current = residual;
        }
        
        wakeRec.current.stop();
        
        setTimeout(() => {
          try { 
            mainRec.current.start(); 
          } catch(e) { 
            console.error("Failed to start mainRec:", e); 
            isTransitioningRef.current = false; 
          }
        }, 400);
      }
    };

    wakeRec.current.onend = () => {
      console.log("Wake rec ended.");
      if (!isTransitioningRef.current && !isListeningRef.current && statusRef.current === 'connected') {
         // Auto-restart passive listener
         setTimeout(() => {
           if (!isTransitioningRef.current && !isListeningRef.current && statusRef.current === 'connected') {
             try { wakeRec.current.start(); } catch(e) {}
           }
         }, 1000);
      }
    };

    return () => {
      if (mainRec.current) mainRec.current.stop();
      if (wakeRec.current) wakeRec.current.stop();
    };
  }, []); // Run exactly once

  // Manage Wake Word lifecycle based on connected status and listening state
  useEffect(() => {
    if (status === 'connected' && !isListening && !isTransitioningRef.current) {
      try { wakeRec.current?.start(); } catch(e) {}
    } else if (isListening) {
      try { wakeRec.current?.stop(); } catch(e) {}
    }
  }, [isListening, status]);

  const handleOrbClick = () => {
    if (isListening) {
      mainRec.current?.stop();
    } else {
      isTransitioningRef.current = true;
      residualRef.current = "";
      transcriptRef.current = "";
      
      // Stop wake word first, wait a bit, then start main
      try { wakeRec.current?.stop(); } catch(e) {}
      setTimeout(() => {
        try { mainRec.current?.start(); } catch(e) { 
            console.error(e); 
            isTransitioningRef.current = false; 
        }
      }, 400);
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
