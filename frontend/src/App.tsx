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
type Session = { title: string, messages: { role: string, text: string }[] };

function App() {
  const [status, setStatus] = useState("disconnected");
  const [isListening, setIsListening] = useState(false);
  const [messages, setMessages] = useState<Message[]>([]);
  
  // UI Toggles
  const [showText, setShowText] = useState(false);
  const [showHistory, setShowHistory] = useState(false);
  const [language, setLanguage] = useState("en-US");
  const [chatInput, setChatInput] = useState("");
  
  const [historyData, setHistoryData] = useState<Record<string, Session>>({});
  const [activeSession, setActiveSession] = useState<string | null>(null);
  
  const ws = useRef<WebSocket | null>(null);
  
  const mainRec = useRef<any>(null);
  const silenceTimer = useRef<any>(null);
  
  const transcriptRef = useRef<string>("");
  const residualRef = useRef<string>("");

  // Initialize WebSocket
  useEffect(() => {
    ws.current = new WebSocket("ws://127.0.0.1:8000/ws/lisa");
    ws.current.onopen = () => setStatus("connected");
    ws.current.onclose = () => setStatus("disconnected");
    ws.current.onerror = (error) => console.error("WebSocket error:", error);
    
    ws.current.onmessage = (event) => {
      const data = JSON.parse(event.data);
      if (data.type === "ui_action") {
        if (data.action === "show_text") setShowText(true);
        if (data.action === "hide_text") setShowText(false);
        if (data.action === "show_history") {
          setShowHistory(true);
          fetchHistory();
        }
        if (data.action === "hide_history") setShowHistory(false);
      } else if (data.type === "message") {
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
    mainRec.current = new SpeechRecognition();
    mainRec.current.continuous = true;
    mainRec.current.interimResults = true;
    mainRec.current.lang = language;

    mainRec.current.onstart = () => {
      console.log("Main rec started.");
      setIsListening(true);
      
      transcriptRef.current = residualRef.current;
      residualRef.current = "";
      
      if (silenceTimer.current) clearTimeout(silenceTimer.current);
      silenceTimer.current = setTimeout(() => {
        if (mainRec.current) mainRec.current.stop();
      }, 3000);
    };

    mainRec.current.onresult = (event: any) => {
      let liveText = "";
      for (let i = 0; i < event.results.length; i++) {
         liveText += event.results[i][0].transcript;
      }
      
      if (residualRef.current) {
          transcriptRef.current = residualRef.current + " " + liveText;
      } else {
          transcriptRef.current = liveText;
      }
      
      if (silenceTimer.current) clearTimeout(silenceTimer.current);
      silenceTimer.current = setTimeout(() => {
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

    return () => {
      if (mainRec.current) mainRec.current.stop();
    };
  }, []);

  useEffect(() => {
    if (mainRec.current) {
      mainRec.current.lang = language;
    }
  }, [language]);

  const handleOrbClick = () => {
    if (isListening) {
      mainRec.current?.stop();
    } else {
      residualRef.current = "";
      transcriptRef.current = "";
      try { mainRec.current?.start(); } catch(e) { console.error(e); }
    }
  };

  // Register global shortcuts
  useEffect(() => {
    import('@tauri-apps/plugin-global-shortcut').then(({ register }) => {
      import('@tauri-apps/api/window').then(({ getCurrentWindow }) => {
        // Toggle UI Visibility
        register('Alt+L', async () => {
          const win = getCurrentWindow();
          const isVisible = await win.isVisible();
          if (isVisible) {
            await win.hide();
          } else {
            await win.show();
            await win.setFocus();
          }
        }).catch(e => console.error("Global shortcut error", e));

        // Start listening globally
        register('CommandOrControl+Shift+L', async () => {
          console.log("Ctrl+Shift+L pressed");
          try {
            if (!isListening) {
              const win = getCurrentWindow();
              await win.show();
              await win.setFocus();
              mainRec.current?.start();
            }
          } catch (e) {
            console.error(e);
          }
        }).catch(e => console.error("Global shortcut Ctrl+Shift+L error", e));
      });
    });
  }, [isListening]);

  const fetchHistory = async () => {
    try {
      const res = await fetch("http://127.0.0.1:8000/history");
      if (res.ok) {
        const data = await res.json();
        setHistoryData(data);
        if (!activeSession && Object.keys(data).length > 0) {
           setActiveSession(Object.keys(data)[Object.keys(data).length - 1]);
        }
      }
    } catch (e) {
      console.error("Failed to fetch history", e);
    }
  };

  const toggleHistory = () => {
    if (!showHistory) {
      fetchHistory();
    }
    setShowHistory(!showHistory);
  };

  const handleChatSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    if (!chatInput.trim()) return;
    
    setMessages((prev) => [...prev, { role: 'user', content: chatInput.trim() }]);
    if (ws.current && ws.current.readyState === WebSocket.OPEN) {
      ws.current.send(chatInput.trim());
    }
    setChatInput("");
    setShowText(true);
  };

  return (
    <div className="lisa-app-wrapper" data-tauri-drag-region>
      {showHistory && (
        <div className="sidebar" data-tauri-drag-region>
          <div className="sidebar-header">
            <h3>LISA Sessions</h3>
            <button onClick={() => setShowHistory(false)} className="close-sidebar">✕</button>
          </div>
          <div className="session-list">
            {Object.entries(historyData).reverse().map(([id, session]) => (
              <div 
                key={id} 
                className={`session-item ${activeSession === id ? 'active' : ''}`}
                onClick={() => setActiveSession(id)}
              >
                {session.title || id}
              </div>
            ))}
          </div>
        </div>
      )}

      <div className={`lisa-container ${showHistory ? 'with-sidebar' : ''}`} data-tauri-drag-region>
        <div className="input-area" data-tauri-drag-region>
          <form onSubmit={handleChatSubmit} style={{ width: '100%' }}>
            <input 
              type="text" 
              className="chat-input" 
              placeholder="Message LISA..." 
              value={chatInput}
              onChange={(e) => setChatInput(e.target.value)}
            />
          </form>
        </div>
        
        <div 
          className={`siri-orb ${status === 'connected' ? 'active' : 'inactive'} ${isListening ? 'listening' : ''}`} 
          onClick={handleOrbClick} 
          data-tauri-drag-region
        >
        </div>
        <div className="status-text" data-tauri-drag-region>
          {isListening ? "Listening..." : (status === "connected" ? "LISA Online" : "Connecting...")}
          <button className="history-btn" onClick={() => setLanguage(l => l === 'en-US' ? 'ta-IN' : 'en-US')}>
             {language === 'en-US' ? "EN" : "TA"}
          </button>
          <button className="history-btn" onClick={toggleHistory}>
             {showHistory ? "Close History" : "View History"}
          </button>
          <button className="history-btn" onClick={() => setShowText(!showText)}>
             {showText ? "Hide Text" : "Show Text"}
          </button>
        </div>
        
        {showHistory && activeSession && historyData[activeSession] ? (
          <div className="message-log" data-tauri-drag-region>
            {historyData[activeSession].messages.map((msg, i) => (
              <div key={i} className={`message ${msg.role === 'user' ? 'user-msg' : 'ai-msg'}`}>
                 {msg.role === 'user' ? msg.text : <ReactMarkdown>{msg.text}</ReactMarkdown>}
              </div>
            ))}
          </div>
        ) : (
          showText && messages.length > 0 && (
            <div className="message-log" data-tauri-drag-region>
              {messages.map((msg, i) => (
                <div key={i} className={`message ${msg.role === 'user' ? 'user-msg' : 'ai-msg'}`}>
                   {msg.role === 'user' ? msg.content : <ReactMarkdown>{msg.content}</ReactMarkdown>}
                </div>
              ))}
            </div>
          )
        )}
      </div>
    </div>
  );
}

export default App;
