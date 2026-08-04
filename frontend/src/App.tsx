import { useState, useEffect, useRef } from "react";
import ReactMarkdown from "react-markdown";
import "./App.css";
import avatarIdleImg from './assets/avatar_idle.png';

// Global interface for Web Speech API
declare global {
  interface Window {
    webkitSpeechRecognition: any;
  }
}

type Message = { role: 'user' | 'ai', content: string };
type Session = { title: string, messages: { role: string, text: string }[] };

// Siri-style Audio Cues using pure Web Audio API
const playWakeSound = () => {
  try {
    const AudioContext = window.AudioContext || (window as any).webkitAudioContext;
    if (!AudioContext) return;
    const ctx = new AudioContext();
    const playNote = (freq: number, time: number) => {
      const osc = ctx.createOscillator();
      const gain = ctx.createGain();
      osc.type = 'sine';
      osc.frequency.value = freq;
      
      gain.gain.setValueAtTime(0, ctx.currentTime + time);
      gain.gain.linearRampToValueAtTime(0.2, ctx.currentTime + time + 0.05);
      gain.gain.exponentialRampToValueAtTime(0.001, ctx.currentTime + time + 0.3);
      
      osc.connect(gain);
      gain.connect(ctx.destination);
      osc.start(ctx.currentTime + time);
      osc.stop(ctx.currentTime + time + 0.3);
    };
    // Siri Wake: E5 then G#5
    playNote(659.25, 0);    
    playNote(830.61, 0.15); 
  } catch (e) {
    console.error(e);
  }
};

const playStopSound = () => {
  try {
    const AudioContext = window.AudioContext || (window as any).webkitAudioContext;
    if (!AudioContext) return;
    const ctx = new AudioContext();
    const playNote = (freq: number, time: number) => {
      const osc = ctx.createOscillator();
      const gain = ctx.createGain();
      osc.type = 'sine';
      osc.frequency.value = freq;
      
      gain.gain.setValueAtTime(0, ctx.currentTime + time);
      gain.gain.linearRampToValueAtTime(0.2, ctx.currentTime + time + 0.05);
      gain.gain.exponentialRampToValueAtTime(0.001, ctx.currentTime + time + 0.3);
      
      osc.connect(gain);
      gain.connect(ctx.destination);
      osc.start(ctx.currentTime + time);
      osc.stop(ctx.currentTime + time + 0.3);
    };
    // Siri Stop: E5 then C5
    playNote(659.25, 0);    
    playNote(523.25, 0.15); 
  } catch (e) {
    console.error(e);
  }
};

function App() {
  const [status, setStatus] = useState("disconnected");
  const [isListening, setIsListening] = useState(false);
  const isListeningRef = useRef(false);
  const previousIsListening = useRef(false);
  
  useEffect(() => {
    isListeningRef.current = isListening;
    
    // Play Siri Audio Cues
    if (isListening && !previousIsListening.current) {
        playWakeSound();
    } else if (!isListening && previousIsListening.current) {
        playStopSound();
    }
    previousIsListening.current = isListening;
  }, [isListening]);

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

  // Particle Canvas Engine removed

  // Initialize WebSocket
  useEffect(() => {
    ws.current = new WebSocket("ws://127.0.0.1:8000/ws/lisa");
    ws.current.onopen = () => setStatus("connected");
    ws.current.onclose = () => setStatus("disconnected");
    ws.current.onerror = (error) => console.error("WebSocket error:", error);
    
    ws.current.onmessage = (event) => {
        try {
          const data = JSON.parse(event.data);
          if (data.type === 'ui_action') {
            if (data.action === 'show_text') setShowText(true);
            if (data.action === 'hide_text') setShowText(false);
            if (data.action === 'show_history') setShowHistory(true);
            if (data.action === 'hide_history') setShowHistory(false);
          } else if (data.type === 'message') {
            if (data.content === "Thinking...") {
              setMessages((prev) => [...prev, { role: 'ai', content: data.content }]);
            } else {
              setMessages((prev) => {
                const filtered = prev.filter(msg => msg.content !== "Thinking...");
                return [...filtered, { role: 'ai', content: data.content }];
              });
            }
            setStatus("connected");
          }
        } catch (e) {
          console.error(e);
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
      // We do NOT set isListening to true here, because it starts in passive mode!
    };

    mainRec.current.onresult = (event: any) => {
      let liveText = "";
      for (let i = 0; i < event.results.length; i++) {
         liveText += event.results[i][0].transcript;
      }
      
      const lowerText = liveText.toLowerCase();

      // --- PASSIVE WAKE WORD MODE ---
      if (!isListeningRef.current) {
         if (lowerText.includes("lisa")) {
             console.log("Wake word detected!");
             setIsListening(true);
             
             // Extract whatever was said after "lisa"
             const parts = lowerText.split("lisa");
             const afterLisa = parts.slice(1).join("lisa").trim();
             
             // We use the original case from liveText if possible, but lowerText is fine for the AI
             transcriptRef.current = afterLisa; 
             
             import('@tauri-apps/api/window').then(({ getCurrentWindow }) => {
                 const win = getCurrentWindow();
                 win.show();
                 win.setFocus();
             });
             
             if (silenceTimer.current) clearTimeout(silenceTimer.current);
             silenceTimer.current = setTimeout(() => {
               if (mainRec.current) mainRec.current.stop();
             }, 3000);
         } else {
             // If they are talking but didn't say lisa, stop and restart after silence to clear memory
             if (silenceTimer.current) clearTimeout(silenceTimer.current);
             silenceTimer.current = setTimeout(() => {
               if (mainRec.current) mainRec.current.stop();
             }, 1500);
         }
         return;
      }

      // --- ACTIVE DICTATION MODE ---
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
      if (event.error === 'not-allowed') {
        setIsListening(false);
      }
    };

    mainRec.current.onend = () => {
      console.log("Main rec ended.");
      
      // If we were actively listening, process the command
      if (isListeningRef.current) {
          setIsListening(false);
          if (silenceTimer.current) clearTimeout(silenceTimer.current);
          
          const finalStr = transcriptRef.current.trim();
          if (finalStr) {
            setMessages((prev) => [...prev, { role: 'user', content: finalStr }]);
            if (ws.current && ws.current.readyState === WebSocket.OPEN) {
              ws.current.send(finalStr);
            }
          }
      }
      
      transcriptRef.current = "";
      residualRef.current = "";
      
      // Always restart for passive wake word listening
      try { mainRec.current.start(); } catch(e) {}
    };

    // Kickoff the initial passive listener
    try { mainRec.current.start(); } catch(e) {}

    return () => {
      if (mainRec.current) {
         mainRec.current.onend = null; // prevent auto-restart on unmount
         mainRec.current.stop();
      }
    };
  }, []);

  useEffect(() => {
    if (mainRec.current) {
      mainRec.current.lang = language;
      try { mainRec.current.stop(); } catch(e) {} // Will auto restart with new lang via onend
    }
  }, [language]);

  const handleOrbClick = () => {
    if (isListening) {
      mainRec.current?.stop(); // This will trigger onend, send msg, and go to passive
    } else {
      setIsListening(true);
      residualRef.current = "";
      transcriptRef.current = "";
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
            if (!isListeningRef.current) {
              setIsListening(true);
              transcriptRef.current = "";
              const win = getCurrentWindow();
              await win.show();
              await win.setFocus();
            }
          } catch (e) {
            console.error(e);
          }
        }).catch(e => console.error("Global shortcut Ctrl+Shift+L error", e));
      });
    });
  }, []);

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
        
        <div 
          className={`lisa-hologram-container ${status === 'connected' ? 'active' : 'inactive'} ${isListening ? 'listening' : ''}`} 
          onClick={handleOrbClick} 
          data-tauri-drag-region
        >
          {isListening && (
            <div className="typing-bubble">
              <span>.</span><span>.</span><span>.</span>
            </div>
          )}
          <div className="hologram-wrapper">
            <img src={avatarIdleImg} alt="LISA Hologram" className="lisa-hologram-avatar" />
            <div className="scanlines"></div>
          </div>
        </div>
        
        {showText && (
          <>
            <div className="status-text" data-tauri-drag-region>
              {isListening ? "Listening..." : (status === "connected" ? "LISA Online" : "Connecting...")}
              <button className="history-btn" onClick={() => setLanguage(l => l === 'en-US' ? 'ta-IN' : 'en-US')}>
                 {language === 'en-US' ? "EN" : "TA"}
              </button>
              <button className="history-btn" onClick={toggleHistory}>
                 {showHistory ? "Close History" : "View History"}
              </button>
              <button className="history-btn" onClick={() => setShowText(!showText)}>
                 Hide Text
              </button>
            </div>
            
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
          </>
        )}
        
        {showHistory && activeSession && historyData[activeSession] ? (
          <div className="message-log" data-tauri-drag-region>
            {historyData[activeSession].messages.map((msg, i) => (
              <div key={i} className={`message ${msg.role === 'user' ? 'user-msg' : 'ai-msg'}`}>
                 {msg.role === 'user' ? msg.text : <ReactMarkdown>{msg.text}</ReactMarkdown>}
              </div>
            ))}
          </div>
        ) : (
          messages.length > 0 && (
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
