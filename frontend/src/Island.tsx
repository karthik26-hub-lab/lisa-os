import { useState, useEffect, useRef } from "react";
import { invoke } from '@tauri-apps/api/core';
import { listen } from '@tauri-apps/api/event';
import "./App.css";

type UIState = "inactive" | "hover" | "listening" | "processing" | "success";

export default function Island() {
  const [uiState, setUiState] = useState<UIState>("inactive");
  const [duration, setDuration] = useState(0);
  
  const ws = useRef<WebSocket | null>(null);
  const mainRec = useRef<any>(null);
  const silenceTimer = useRef<any>(null);
  const durationTimer = useRef<any>(null);
  const transcriptRef = useRef<string>("");
  const residualRef = useRef<string>("");

  // Load and sync theme
  useEffect(() => {
    fetch("http://127.0.0.1:8000/api/settings")
      .then(res => res.json())
      .then(data => {
         if (data.theme === "dark") {
             document.body.classList.add("dark");
         } else {
             document.body.classList.remove("dark");
         }
      }).catch(e => console.error(e));

    const setupThemeListener = async () => {
        return await listen('theme_changed', (event) => {
            if (event.payload === "dark") {
                document.body.classList.add("dark");
            } else {
                document.body.classList.remove("dark");
            }
        });
    };
    let unlisten: any;
    setupThemeListener().then(u => unlisten = u);
    return () => { if (unlisten) unlisten(); };
  }, []);

  // Connect to websocket
  useEffect(() => {
    ws.current = new WebSocket("ws://127.0.0.1:8000/ws/lisa");
    
    ws.current.onmessage = (event) => {
        try {
            const data = JSON.parse(event.data);
            if (data.type === "message" && data.content.startsWith("Typed:")) {
                setUiState("success");
                setTimeout(() => setUiState("inactive"), 2500);
            } else if (data.type === "toggle_mic") {
                setUiState((prev) => {
                  if (prev === "inactive" || prev === "hover" || prev === "success") {
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
        } catch(e) {}
    };

    return () => ws.current?.close();
  }, []);

  const playWakeSound = () => {
    try {
      const AudioContext = window.AudioContext || (window as any).webkitAudioContext;
      if (AudioContext) {
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
      }
    } catch(e) {}
  };

  const playStopSound = () => {
    try {
      const AudioContext = window.AudioContext || (window as any).webkitAudioContext;
      if (AudioContext) {
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
      }
    } catch(e) {}
  };

  // Duration Timer
  useEffect(() => {
    if (uiState === "listening") {
      playWakeSound();
      setDuration(0);
      durationTimer.current = setInterval(() => {
        setDuration(d => d + 1);
      }, 1000);
    } else {
      if (durationTimer.current) clearInterval(durationTimer.current);
    }
    return () => {
      if (durationTimer.current) clearInterval(durationTimer.current);
    }
  }, [uiState]);

  // Speech Recognition
  useEffect(() => {
    if (!('webkitSpeechRecognition' in window)) return;
    if (uiState !== "listening") return;

    const SpeechRecognition = window.webkitSpeechRecognition;
    mainRec.current = new SpeechRecognition();
    mainRec.current.continuous = true;
    mainRec.current.interimResults = true;
    mainRec.current.lang = "en-IN";

    mainRec.current.onresult = (event: any) => {
      let liveText = "";
      for (let i = 0; i < event.results.length; i++) {
         liveText += event.results[i][0].transcript;
      }
      if (residualRef.current) transcriptRef.current = residualRef.current + " " + liveText;
      else transcriptRef.current = liveText;
      
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
             setUiState("inactive");
          }
      }
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

  const toggleMic = () => {
    setUiState((prev) => {
      if (prev === "listening") {
        mainRec.current?.stop();
        return prev;
      } else {
        residualRef.current = "";
        transcriptRef.current = "";
        return "listening";
      }
    });
  };

  // Listen for Rust backend hotkey
  useEffect(() => {
    let unlisten: any;
    const setup = async () => {
       unlisten = await listen('toggle_mic', () => {
           toggleMic();
       });
    };
    setup();
    return () => {
       if (unlisten) unlisten();
    };
  }, []);

  const openDashboard = async () => {
     try {
       await invoke('show_dashboard');
     } catch(e) { 
       console.error("Dashboard error:", e);
     }
  };

  const formatDuration = (seconds: number) => {
      const m = Math.floor(seconds / 60);
      const s = seconds % 60;
      return `${m}:${s.toString().padStart(2, '0')}`;
  };

  return (
    <div className="w-screen h-screen flex justify-center items-start pt-0 overflow-hidden select-none bg-transparent font-display" data-tauri-drag-region>
      <div 
        className={`group relative flex items-center justify-center transition-all duration-500 ease-[cubic-bezier(0.16,1,0.3,1)] cursor-pointer`}
        style={{
          width: uiState === 'inactive' ? '96px' : uiState === 'hover' ? '120px' : uiState === 'listening' ? '200px' : uiState === 'processing' ? '130px' : '100px',
          height: uiState === 'inactive' ? '28px' : uiState === 'hover' ? '32px' : uiState === 'listening' ? '32px' : '28px',
        }}
        onClick={uiState === 'listening' ? toggleMic : (uiState === 'inactive' || uiState === 'hover') ? toggleMic : undefined}
        onMouseEnter={() => setUiState(prev => prev === 'inactive' ? 'hover' : prev)}
        onMouseLeave={() => setUiState(prev => prev === 'hover' ? 'inactive' : prev)}
      >
        
        {/* Main Background with Glass Effect */}
        <div className="absolute inset-0 bg-white/60 dark:bg-[#1C1C1E]/80 backdrop-blur-2xl rounded-b-[20px] border-b border-white/50 dark:border-white/10 shadow-[0_10px_30px_rgba(0,0,0,0.2)] dark:shadow-[0_10px_30px_rgba(0,0,0,0.5)] group-hover:bg-white/70 dark:group-hover:bg-[#1C1C1E]/90 transition-colors duration-500"></div>

        {/* Glow effect for processing */}
        {uiState === 'processing' && (
           <div className="absolute inset-0 rounded-b-[20px] pointer-events-none transition-opacity duration-700 animate-pulse bg-primary/10 opacity-100" />
        )}

        {/* States Content (z-10 to stay above background) */}
        <div className="z-10 flex w-full h-full items-center justify-center">
          
          {(uiState === 'inactive' || uiState === 'hover') && (
            <div className="flex items-center gap-2 pointer-events-none transition-all duration-300 opacity-100 scale-100">
              {/* Idle Waveform Icon */}
              <div className="flex items-center justify-center gap-[1.5px] h-2.5 opacity-80">
                <div className="w-[1.5px] bg-[#1C1C1E] dark:bg-[#F2F2F7] rounded-full" style={{height: '40%'}}></div>
                <div className="w-[1.5px] bg-[#1C1C1E] dark:bg-[#F2F2F7] rounded-full" style={{height: '70%'}}></div>
                <div className="w-[1.5px] bg-[#1C1C1E] dark:bg-[#F2F2F7] rounded-full" style={{height: '100%'}}></div>
                <div className="w-[1.5px] bg-[#1C1C1E] dark:bg-[#F2F2F7] rounded-full" style={{height: '70%'}}></div>
                <div className="w-[1.5px] bg-[#1C1C1E] dark:bg-[#F2F2F7] rounded-full" style={{height: '40%'}}></div>
              </div>
              <span className="text-[11px] font-bold tracking-[0.1em] text-[#1C1C1E] dark:text-[#F2F2F7]">LISA</span>
            </div>
          )}

          {uiState === 'listening' && (
            <div className="relative flex items-center justify-center w-full px-4 pointer-events-none">
              {/* Left: Timer (Absolute for perfect centering of wave) */}
              <span className="absolute left-4 text-[11px] font-mono text-[#1C1C1E]/70 dark:text-[#F2F2F7]/70 font-bold">{formatDuration(duration)}</span>
              
              {/* Center: Soundwave */}
              <div className="flex items-center gap-[3px] h-4">
                <div className="soundwave-bar" style={{animationDelay: '0s'}}></div>
                <div className="soundwave-bar" style={{animationDelay: '0.1s'}}></div>
                <div className="soundwave-bar" style={{animationDelay: '0.3s'}}></div>
                <div className="soundwave-bar" style={{animationDelay: '0.2s'}}></div>
                <div className="soundwave-bar" style={{animationDelay: '0.4s'}}></div>
                <div className="soundwave-bar" style={{animationDelay: '0.1s'}}></div>
                <div className="soundwave-bar" style={{animationDelay: '0s'}}></div>
              </div>

              {/* Right: App Logo */}
              <img src="/logo.png" className="absolute right-4 w-[14px] h-[14px] object-contain opacity-70 dark:invert" alt="Lisa Logo" />
            </div>
          )}

          {uiState === 'processing' && (
            <div className="flex items-center gap-2 pointer-events-none">
              <span className="material-symbols-outlined text-primary text-[14px] animate-spin" style={{fontVariationSettings: "'FILL' 1"}}>progress_activity</span>
              <span className="text-[11px] font-bold tracking-wide text-[#1C1C1E] dark:text-[#F2F2F7]">Understanding</span>
            </div>
          )}

          {uiState === 'success' && (
            <div className="flex items-center gap-1.5 pointer-events-none text-emerald-600">
              <span className="material-symbols-outlined text-[14px]">check_circle</span>
              <span className="text-[11px] font-bold tracking-wide">Inserted</span>
            </div>
          )}

          {/* Settings button when hovered */}
          {uiState === 'hover' && (
            <button 
              onClick={(e) => { e.stopPropagation(); openDashboard(); }}
              className="absolute right-2 w-5 h-5 rounded-full hover:bg-black/10 dark:hover:bg-white/10 flex items-center justify-center transition-colors"
              title="Open Dashboard"
            >
              <span className="material-symbols-outlined text-[13px] text-[#1C1C1E]/60 hover:text-[#1C1C1E] dark:text-[#F2F2F7]/60 dark:hover:text-[#F2F2F7]">settings</span>
            </button>
          )}

        </div>
      </div>
    </div>
  );
}
