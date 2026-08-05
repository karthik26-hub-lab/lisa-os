import { useState, useEffect, useRef } from "react";
import ReactMarkdown from "react-markdown";
import "./App.css";
import Live2DViewer from "./Live2DViewer";

// Global interface for Web Speech API
declare global {
  interface Window {
    webkitSpeechRecognition: any;
  }
}

type Message = { role: 'user' | 'ai', content: string };
type Session = { title: string, messages: { role: string, text: string }[] };

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
    playNote(659.25, 0);    
    playNote(523.25, 0.15); 
  } catch (e) {
    console.error(e);
  }
};

function App() {
  const [status, setStatus] = useState("disconnected");
  const [isListening, setIsListening] = useState(false);
  const [isSpeaking, setIsSpeaking] = useState(false);
  const isListeningRef = useRef(false);
  const previousIsListening = useRef(false);
  
  const [messages, setMessages] = useState<Message[]>([]);
  const [chatInput, setChatInput] = useState("");
  const [language, setLanguage] = useState("en-US");
  
  const [showSettings, setShowSettings] = useState(false);
  const [settingsTab, setSettingsTab] = useState("history"); // 'history' or 'personalize'
  const [historyData, setHistoryData] = useState<Record<string, Session>>({});
  const [activeSession, setActiveSession] = useState<string | null>(null);
  const [micError, setMicError] = useState<string | null>(null);
  
  const ws = useRef<WebSocket | null>(null);
  const mainRec = useRef<any>(null);
  const silenceTimer = useRef<any>(null);
  const transcriptRef = useRef<string>("");
  const residualRef = useRef<string>("");

  useEffect(() => {
    window.speechSynthesis.getVoices();
    window.speechSynthesis.onvoiceschanged = () => {
      window.speechSynthesis.getVoices();
    };
  }, []);
  
  useEffect(() => {
    isListeningRef.current = isListening;
    if (isListening && !previousIsListening.current) {
        playWakeSound();
    } else if (!isListening && previousIsListening.current) {
        playStopSound();
    }
    previousIsListening.current = isListening;
  }, [isListening]);

  useEffect(() => {
    ws.current = new WebSocket("ws://127.0.0.1:8000/ws/lisa");
    ws.current.onopen = () => setStatus("connected");
    ws.current.onclose = () => setStatus("disconnected");
    ws.current.onerror = (error) => console.error("WebSocket error:", error);
    
    ws.current.onmessage = (event) => {
        try {
          const data = JSON.parse(event.data);
          if (data.type === 'ui_action') {
            if (data.action === 'show_history') setShowSettings(true);
            if (data.action === 'hide_history') setShowSettings(false);
          } else if (data.type === 'message') {
            if (data.content === "Thinking...") {
              setMessages((prev) => [...prev, { role: 'ai', content: data.content }]);
            } else {
              setMessages((prev) => {
                const filtered = prev.filter(msg => msg.content !== "Thinking...");
                return [...filtered, { role: 'ai', content: data.content }];
              });
              
              const cleanText = data.content.replace(/[*#`_]/g, '');
              if (cleanText.trim()) {
                window.speechSynthesis.cancel();
                const utterance = new SpeechSynthesisUtterance(cleanText);
                let voices = window.speechSynthesis.getVoices();
                if (voices.length === 0) voices = window.speechSynthesis.getVoices();
                
                let femaleVoice = voices.find(v => {
                  const name = v.name.toLowerCase();
                  return name.includes("zira") || name.includes("female") || name.includes("samantha") || name.includes("victoria") || name.includes("hazel") || name.includes("susan") || name.includes("catherine");
                });
                
                if (!femaleVoice && voices.length > 0) femaleVoice = voices[0];
                if (femaleVoice) utterance.voice = femaleVoice;
                
                utterance.rate = 1.05;
                utterance.onstart = () => setIsSpeaking(true);
                utterance.onend = () => setIsSpeaking(false);
                utterance.onerror = () => setIsSpeaking(false);
                window.speechSynthesis.speak(utterance);
              }
            }
            setStatus("connected");
          }
        } catch (e) {
          console.error(e);
        }
      };
    
    return () => ws.current?.close();
  }, []);

  useEffect(() => {
    if (!('webkitSpeechRecognition' in window)) {
      console.warn("Speech Recognition API not supported.");
      setMicError("Mic Error: API Not Supported in this environment");
      return;
    }

    const SpeechRecognition = window.webkitSpeechRecognition;
    mainRec.current = new SpeechRecognition();
    mainRec.current.continuous = true;
    mainRec.current.interimResults = true;
    mainRec.current.lang = language;

    mainRec.current.onstart = () => {
      setMicError(null);
    };

    mainRec.current.onresult = (event: any) => {
      let liveText = "";
      for (let i = 0; i < event.results.length; i++) {
         liveText += event.results[i][0].transcript;
      }
      
      const lowerText = liveText.toLowerCase();

      if (!isListeningRef.current) {
         if (lowerText.includes("lisa")) {
             setIsListening(true);
             const parts = lowerText.split("lisa");
             transcriptRef.current = parts.slice(1).join("lisa").trim(); 
             
             import('@tauri-apps/api/window').then(({ getCurrentWindow }) => {
                 const win = getCurrentWindow();
                 win.show();
                 win.setFocus();
             }).catch(() => {});
             
             if (silenceTimer.current) clearTimeout(silenceTimer.current);
             silenceTimer.current = setTimeout(() => {
               if (mainRec.current) mainRec.current.stop();
             }, 3000);
         } else {
             if (silenceTimer.current) clearTimeout(silenceTimer.current);
             silenceTimer.current = setTimeout(() => {
               if (mainRec.current) mainRec.current.stop();
             }, 1500);
         }
         return;
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
      setMicError(`Mic Error: ${event.error}`);
      if (event.error === 'not-allowed') {
        setIsListening(false);
      }
    };

    mainRec.current.onend = () => {
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
      try { mainRec.current.start(); } catch(e) {}
    };

    try { mainRec.current.start(); } catch(e) {}

    return () => {
      if (mainRec.current) {
         mainRec.current.onend = null;
         mainRec.current.stop();
      }
    };
  }, []);

  useEffect(() => {
    if (mainRec.current) {
      mainRec.current.lang = language;
      try { mainRec.current.stop(); } catch(e) {}
    }
  }, [language]);

  const toggleMic = () => {
    if (isListening) {
      mainRec.current?.stop();
    } else {
      setIsListening(true);
      residualRef.current = "";
      transcriptRef.current = "";
    }
  };

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

  const handleSettingsOpen = () => {
    setShowSettings(true);
    if (settingsTab === 'history') {
      fetchHistory();
    }
  };

  const handleChatSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    if (!chatInput.trim()) return;
    
    setMessages((prev) => [...prev, { role: 'user', content: chatInput.trim() }]);
    if (ws.current && ws.current.readyState === WebSocket.OPEN) {
      ws.current.send(chatInput.trim());
    }
    setChatInput("");
  };
  
  // Auto-scroll chat log
  const chatEndRef = useRef<HTMLDivElement>(null);
  useEffect(() => {
    chatEndRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [messages, activeSession]);

  return (
    <div className="lisa-app-wrapper" data-tauri-drag-region>
      {/* Background Ambience */}
      <div className="bg-blobs">
        <div className="blob blob-1"></div>
        <div className="blob blob-2"></div>
        <div className="blob blob-3"></div>
      </div>

      {/* Top Nav */}
      <div className="top-nav" data-tauri-drag-region>
        <div className="greeting">Hello bby!!!!</div>
        <div className="settings-btn" onClick={handleSettingsOpen}>
          ⚙️
        </div>
      </div>

      {/* Main Split Layout */}
      <div className="main-layout" data-tauri-drag-region>
        
        {/* Left Column: Glassmorphic Chat */}
        <div className="left-column">
          <div className="chat-glass-container">
            <div className="chat-content-wrapper">
              <div className="status-indicator">
                <span className={`status-dot ${status !== 'connected' ? 'disconnected' : ''}`}></span>
                {status === "connected" ? "LISA CONNECTED" : "OFFLINE"}
              </div>
              
              {micError && <div style={{color: '#ff0a54', fontSize: '0.95rem', marginBottom: '15px'}}>{micError}</div>}

              <div className="message-log">
                {messages.length === 0 && <div style={{opacity: 0.4, textAlign: 'center', marginTop: 'auto', marginBottom: 'auto', fontSize: '1.2rem'}}>Awaiting your command...</div>}
                {messages.map((msg, i) => (
                  <div key={i} className={`message ${msg.role === 'user' ? 'user-msg' : 'ai-msg'}`}>
                     {msg.role === 'user' ? msg.content : <ReactMarkdown>{msg.content}</ReactMarkdown>}
                  </div>
                ))}
                <div ref={chatEndRef} />
              </div>

              <div className="input-area">
                <button 
                  className={`mic-btn ${isListening ? 'listening' : ''}`}
                  onClick={toggleMic}
                  title="Voice Input"
                >
                  🎙️
                </button>
                <form onSubmit={handleChatSubmit} style={{ flex: 1, display: 'flex' }}>
                  <input 
                    type="text" 
                    className="chat-input" 
                    placeholder="Message LISA..." 
                    value={chatInput}
                    onChange={(e) => setChatInput(e.target.value)}
                  />
                </form>
              </div>
            </div>
          </div>
        </div>

        {/* Right Column: Live2D Avatar */}
        <div className="right-column">
          <div className="lisa-live2d-container">
            <Live2DViewer isSpeaking={isSpeaking} />
          </div>
        </div>
        
      </div>

      {/* Settings Modal */}
      {showSettings && (
        <div className="settings-modal-overlay" onClick={() => setShowSettings(false)}>
          <div className="settings-modal" onClick={e => e.stopPropagation()}>
            <div className="modal-header">
              <h2>Settings</h2>
              <button className="close-btn" onClick={() => setShowSettings(false)}>✕</button>
            </div>
            
            <div className="modal-content">
              <div className="settings-sidebar">
                <div 
                  className={`settings-tab ${settingsTab === 'personalize' ? 'active' : ''}`}
                  onClick={() => setSettingsTab('personalize')}
                >
                  ✨ Personalize LISA
                </div>
                <div 
                  className={`settings-tab ${settingsTab === 'history' ? 'active' : ''}`}
                  onClick={() => { setSettingsTab('history'); fetchHistory(); }}
                >
                  📚 Chat History
                </div>
              </div>
              
              <div className="settings-body">
                {settingsTab === 'personalize' && (
                  <div>
                    <h3>Personalization Options</h3>
                    <div className="form-group">
                      <label>Language Recognition</label>
                      <select 
                        className="form-select"
                        value={language}
                        onChange={(e) => setLanguage(e.target.value)}
                      >
                        <option value="en-US">English (US)</option>
                        <option value="ta-IN">Tamil (India)</option>
                      </select>
                    </div>
                    {/* Add more personalization fields here in the future */}
                  </div>
                )}
                
                {settingsTab === 'history' && (
                  <div className="history-list">
                    {Object.entries(historyData).reverse().length === 0 && <p>No history found.</p>}
                    {Object.entries(historyData).reverse().map(([id, session]) => (
                      <div 
                        key={id} 
                        className={`history-card ${activeSession === id ? 'active' : ''}`}
                        onClick={() => { setActiveSession(id); setShowSettings(false); }}
                      >
                        <h4>{session.title || id}</h4>
                        <p>{session.messages.length} messages in this conversation</p>
                      </div>
                    ))}
                  </div>
                )}
              </div>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

export default App;
