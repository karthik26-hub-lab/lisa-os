import { useState, useEffect, useRef } from "react";
import "./App.css";

// Global interface for Web Speech API
declare global {
  interface Window {
    webkitSpeechRecognition: any;
  }
}

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
  const isListeningRef = useRef(false);
  const previousIsListening = useRef(false);
  
  const [micError, setMicError] = useState<string | null>(null);
  
  const ws = useRef<WebSocket | null>(null);
  const mainRec = useRef<any>(null);
  const silenceTimer = useRef<any>(null);
  const transcriptRef = useRef<string>("");
  const residualRef = useRef<string>("");

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
    
    return () => ws.current?.close();
  }, []);

  useEffect(() => {
    if (!('webkitSpeechRecognition' in window)) {
      console.warn("Speech Recognition API not supported.");
      setMicError("API Not Supported");
      return;
    }

    const SpeechRecognition = window.webkitSpeechRecognition;
    mainRec.current = new SpeechRecognition();
    mainRec.current.continuous = true;
    mainRec.current.interimResults = true;
    mainRec.current.lang = "en-US"; // Default language

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
      setMicError(event.error);
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
            // Send to backend to type it out via pyautogui
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

  const toggleMic = () => {
    if (isListening) {
      mainRec.current?.stop();
    } else {
      setIsListening(true);
      residualRef.current = "";
      transcriptRef.current = "";
    }
  };

  return (
    <>
      <div className="drag-region" data-tauri-drag-region></div>
      <div className={`whisper-pill ${isListening ? 'listening' : ''}`}>
        <div className="mic-icon" onClick={toggleMic}>
          🎙️
        </div>
        
        {isListening ? (
          <div className="waveform">
            <div className="bar"></div>
            <div className="bar"></div>
            <div className="bar"></div>
            <div className="bar"></div>
            <div className="bar"></div>
          </div>
        ) : (
          <div className="status-text" data-tauri-drag-region>
            {status === "connected" ? "WhisperFlow" : "Connecting..."}
          </div>
        )}
        
        {micError && <div className="error-text">Mic Error: {micError}</div>}
      </div>
    </>
  );
}

export default App;
