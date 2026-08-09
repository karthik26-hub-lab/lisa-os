import { useState, useEffect, useRef, MouseEvent as ReactMouseEvent } from "react";
import { register } from '@tauri-apps/plugin-global-shortcut';
import "./App.css";

declare global {
  interface Window {
    webkitSpeechRecognition: any;
  }
}

type UIState = "idle" | "listening" | "processing";

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
  const [uiState, setUiState] = useState<UIState>("idle");
  const [duration, setDuration] = useState(0);
  
  const ws = useRef<WebSocket | null>(null);
  const mainRec = useRef<any>(null);
  const silenceTimer = useRef<any>(null);
  const durationTimer = useRef<any>(null);
  const transcriptRef = useRef<string>("");
  const residualRef = useRef<string>("");

  useEffect(() => {
    // Theme toggler via right click on body
    const handleContextMenu = (e: MouseEvent) => {
      e.preventDefault();
      document.body.classList.toggle("dark");
    };
    document.addEventListener("contextmenu", handleContextMenu);

    // Register Global Shortcut (Ctrl+K)
    let unregister: (() => void) | undefined;
    const setupShortcut = async () => {
      try {
        await register('CmdOrCtrl+Shift+K', (event) => {
          if (event.state === 'Pressed') {
            setUiState((prev) => {
              if (prev === "idle") {
                 residualRef.current = "";
                 transcriptRef.current = "";
                 return "listening";
              } else if (prev === "listening") {
                 mainRec.current?.stop();
                 return prev;
              }
              return prev;
            });
          }
        });
      } catch(e) {
        console.warn("Global shortcut registration failed:", e);
      }
    };
    setupShortcut();

    return () => {
      document.removeEventListener("contextmenu", handleContextMenu);
    };
  }, []);

  useEffect(() => {
    ws.current = new WebSocket("ws://127.0.0.1:8000/ws/lisa");
    
    ws.current.onmessage = (event) => {
        try {
            const data = JSON.parse(event.data);
            if (data.type === "message" && data.content.startsWith("Typed:")) {
                setUiState("idle");
            }
        } catch(e) {}
    };

    return () => ws.current?.close();
  }, []);

  useEffect(() => {
    if (uiState === "listening") {
      setDuration(0);
      durationTimer.current = setInterval(() => {
        setDuration(d => d + 1);
      }, 1000);
      playWakeSound();
    } else {
      if (durationTimer.current) clearInterval(durationTimer.current);
    }
    
    return () => {
      if (durationTimer.current) clearInterval(durationTimer.current);
    }
  }, [uiState]);

  useEffect(() => {
    if (!('webkitSpeechRecognition' in window)) {
      console.warn("Speech Recognition API not supported.");
      return;
    }

    if (uiState !== "listening") {
      return;
    }

    const SpeechRecognition = window.webkitSpeechRecognition;
    mainRec.current = new SpeechRecognition();
    mainRec.current.continuous = true;
    mainRec.current.interimResults = true;
    mainRec.current.lang = "en-US";

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
      }, 2500);
    };

    mainRec.current.onend = () => {
      if (uiState === "listening") {
          playStopSound();
          setUiState("processing");
          if (silenceTimer.current) clearTimeout(silenceTimer.current);
          
          const finalStr = transcriptRef.current.trim();
          if (finalStr && ws.current && ws.current.readyState === WebSocket.OPEN) {
            ws.current.send(finalStr);
          } else {
             // If nothing to send, return to idle
             setUiState("idle");
          }
      }
      transcriptRef.current = "";
      residualRef.current = "";
    };

    try { mainRec.current.start(); } catch(e) {}

    return () => {
      if (mainRec.current) {
         mainRec.current.onend = null;
         mainRec.current.stop();
      }
    };
  }, [uiState]);

  const toggleMic = (e: ReactMouseEvent) => {
    // Only toggle on left click
    if (e.button !== 0) return;
    
    if (uiState === "listening") {
      mainRec.current?.stop();
    } else if (uiState === "idle") {
      setUiState("listening");
      residualRef.current = "";
      transcriptRef.current = "";
    }
  };

  const formatDuration = (seconds: number) => {
      const m = Math.floor(seconds / 60);
      const s = seconds % 60;
      return `${m}:${s.toString().padStart(2, '0')}`;
  };

  // Render the appropriate state
  if (uiState === "listening") {
    return (
      <div className="drag-region" data-tauri-drag-region>
        <div className="pill-container pill-recording">
          <div className="waveform-container">
            <div className="waveform-bar"></div>
            <div className="waveform-bar"></div>
            <div className="waveform-bar"></div>
            <div className="waveform-bar"></div>
            <div className="waveform-bar"></div>
          </div>
          <div className="text-primary-label animate-pulse">{formatDuration(duration)}</div>
          <button className="stop-btn" onClick={toggleMic}>
            <span className="material-symbols-outlined icon-error">close</span>
          </button>
        </div>
      </div>
    );
  }
  
  if (uiState === "processing") {
    return (
      <div className="drag-region" data-tauri-drag-region>
        <div className="pill-container pill-processing">
          <span className="material-symbols-outlined icon-primary animate-spin" style={{marginRight: '12px'}}>progress_activity</span>
          <span className="text-headline" style={{fontSize: '16px', margin: 0, color: 'var(--text-main)'}}>Understanding...</span>
        </div>
      </div>
    );
  }

  // Idle
  return (
    <div className="drag-region" data-tauri-drag-region>
      <div className="pill-container pill-idle" onClick={toggleMic}>
        <div className="mic-btn">
          <span className="material-symbols-outlined icon-primary" style={{fontVariationSettings: "'FILL' 1"}}>mic</span>
        </div>
        <span className="text-headline">Press to speak</span>
        <div className="divider"></div>
        <span className="text-label">
          <span className="material-symbols-outlined" style={{fontSize: '16px'}}>keyboard_command_key</span> + Shift + K
        </span>
      </div>
    </div>
  );
}

export default App;
