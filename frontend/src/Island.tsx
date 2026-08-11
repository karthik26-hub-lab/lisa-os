import { useState, useEffect, useRef } from "react";
import { invoke } from '@tauri-apps/api/core';
import { listen } from '@tauri-apps/api/event';
import { playChime, playSnap, playAlarm } from './utils/audio';
import "./App.css";

type UIState = "inactive" | "hover" | "listening" | "listening_continuous" | "processing" | "success";

export default function Island() {
  const [uiState, setUiState] = useState<UIState>("inactive");
  const [duration, setDuration] = useState(0);
  const [showSettings, setShowSettings] = useState(false);
  const [volumes, setVolumes] = useState<number[]>([0, 0, 0, 0, 0]);
  const [langMode, setLangMode] = useState<'auto' | 'en' | 'ta'>('auto');
  const [pillColor, setPillColor] = useState<string>(() => localStorage.getItem('pill_color') || 'black');
  const [isSetupComplete, setIsSetupComplete] = useState(() => localStorage.getItem("setup_complete") === "true");

  useEffect(() => {
     if (!isSetupComplete) {
         invoke('show_dashboard').catch(() => {});
     }
  }, [isSetupComplete]);

  useEffect(() => {
     let unlisten: any;
     let isCancelled = false;
     import('@tauri-apps/api/event').then(({ listen }) => {
         listen('setup_finished', () => {
             setIsSetupComplete(true);
         }).then(u => {
             if (isCancelled) u(); else unlisten = u;
         });
     });
     return () => { isCancelled = true; if (unlisten) unlisten(); }
  }, []);

  useEffect(() => {
     let unlisten: any;
     let isCancelled = false;
     import('@tauri-apps/api/event').then(({ listen }) => {
         listen('pill_color_changed', (e) => {
             setPillColor(e.payload as string);
         }).then(u => {
             if (isCancelled) u(); else unlisten = u;
         });
     });
     return () => { isCancelled = true; if (unlisten) unlisten(); }
  }, []);

  useEffect(() => {
      if (uiState === 'inactive' || uiState === 'processing' || uiState === 'success') {
          isPressed.current = false;
          clickCount.current = 0;
      }
  }, [uiState]);

  useEffect(() => {
      if (uiState === 'hover') {
          const t = setTimeout(() => setShowSettings(true), 150);
          return () => clearTimeout(t);
      } else {
          setShowSettings(false);
      }
  }, [uiState]);
  
  const ws = useRef<WebSocket | null>(null);
  const mainRec = useRef<any>(null);
  const silenceTimer = useRef<any>(null);
  const durationTimer = useRef<any>(null);
  const transcriptRef = useRef<string>("");
  const residualRef = useRef<string>("");
  const cancelSendRef = useRef<boolean>(false);
  const pressTime = useRef<number>(0);
  const clickCount = useRef<number>(0);
  const isPressed = useRef<boolean>(false);
  const uiStateRef = useRef<UIState>(uiState);
  
  useEffect(() => {
     uiStateRef.current = uiState;
  }, [uiState]);

  useEffect(() => {
     if (uiState === 'listening' || uiState === 'listening_continuous') {
         playChime();
     } else if (uiState === 'success') {
         playSnap();
     }
  }, [uiState]);
  
  const audioContextRef = useRef<AudioContext | null>(null);
  const analyserRef = useRef<AnalyserNode | null>(null);
  const micStreamRef = useRef<MediaStream | null>(null);
  const dataArrayRef = useRef<Uint8Array | null>(null);
  const animationRef = useRef<number>(0);

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

    let unlisten: any;
    let isCancelled = false;
    const setupThemeListener = async () => {
        const u = await listen('theme_changed', (event) => {
            if (event.payload === "dark") {
                document.body.classList.add("dark");
            } else {
                document.body.classList.remove("dark");
            }
        });
        if (isCancelled) u(); else unlisten = u;
    };
    setupThemeListener();
    return () => { isCancelled = true; if (unlisten) unlisten(); };
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
            } else if (data.type === "start_mic") {
                setUiState("listening");
                residualRef.current = "";
                transcriptRef.current = "";
            } else if (data.type === "stop_mic") {
                mainRec.current?.stop();
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
  const isMicActive = uiState === "listening" || uiState === "listening_continuous";

  useEffect(() => {
    if (!('webkitSpeechRecognition' in window)) return;
    if (!isMicActive) return;

    const SpeechRecognition = window.webkitSpeechRecognition;
    mainRec.current = new SpeechRecognition();
    mainRec.current.continuous = true;
    mainRec.current.interimResults = true;
    
    if (langMode === 'en') {
        mainRec.current.lang = 'en-US';
    } else if (langMode === 'ta') {
        mainRec.current.lang = 'ta-IN';
    } else {
        mainRec.current.lang = ''; // browser default
    }

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
      const currentUiState = uiStateRef.current;
      if (currentUiState === "listening" || currentUiState === "listening_continuous") {
          if (cancelSendRef.current) {
              cancelSendRef.current = false;
              setUiState("inactive");
              residualRef.current = "";
              return;
          }
          playStopSound();
          setUiState("processing");
          if (silenceTimer.current) clearTimeout(silenceTimer.current);
          
          const finalStr = transcriptRef.current.trim();
          if (finalStr && ws.current && ws.current.readyState === WebSocket.OPEN) {
            ws.current.send(JSON.stringify({ text: finalStr, source: 'global' }));
          } else {
             setUiState("inactive");
          }
      }
      residualRef.current = "";
    };

    try { mainRec.current.start(); } catch(e) {}

    let isMounted = true;
    navigator.mediaDevices.getUserMedia({ audio: true }).then(stream => {
      if (!isMounted) {
          // If unmounted before stream resolves, stop it to prevent hardware memory leaks
          stream.getTracks().forEach(t => t.stop());
          return;
      }
      micStreamRef.current = stream;
      const AudioContextClass = window.AudioContext || (window as any).webkitAudioContext;
      const ctx = new AudioContextClass();
      audioContextRef.current = ctx;
      const source = ctx.createMediaStreamSource(stream);
      const analyser = ctx.createAnalyser();
      analyser.fftSize = 64;
      source.connect(analyser);
      analyserRef.current = analyser;
      
      const bufferLength = analyser.frequencyBinCount;
      const dataArray = new Uint8Array(bufferLength);
      dataArrayRef.current = dataArray;
      
      let isResuming = false;
      const updateVolumes = () => {
        if (!analyserRef.current || !dataArrayRef.current) return;
        if (audioContextRef.current && audioContextRef.current.state === 'suspended' && !isResuming) {
            isResuming = true;
            audioContextRef.current.resume().then(() => { isResuming = false; }).catch(() => { isResuming = false; });
        }
        analyserRef.current.getByteFrequencyData(dataArrayRef.current);
        
        const v1 = dataArrayRef.current[2] / 255.0;
        const v2 = dataArrayRef.current[5] / 255.0;
        const v3 = dataArrayRef.current[8] / 255.0;
        const v4 = dataArrayRef.current[11] / 255.0;
        const v5 = dataArrayRef.current[14] / 255.0;
        
        setVolumes([v1, v2, v3, v4, v5]);
        animationRef.current = requestAnimationFrame(updateVolumes);
      };
      updateVolumes();
    }).catch(err => console.error("Mic access denied", err));

    return () => {
      isMounted = false;
      if (animationRef.current) cancelAnimationFrame(animationRef.current);
      if (micStreamRef.current) {
         micStreamRef.current.getTracks().forEach(t => t.stop());
      }
      if (audioContextRef.current) {
         audioContextRef.current.close().catch(e => {});
      }
      setVolumes([0, 0, 0, 0, 0]);
      if (mainRec.current) {
         mainRec.current.onend = null;
         mainRec.current.stop();
      }
    };
  }, [isMicActive]);

  const handleAltXPressed = () => {
    const currentUiState = uiStateRef.current;
    
    if (currentUiState === "listening" || currentUiState === "listening_continuous") {
        // Toggle OFF
        mainRec.current?.stop();
    } else {
        // Toggle ON
        residualRef.current = "";
        transcriptRef.current = "";
        setUiState("listening"); // Or listening_continuous, depending on preference
    }
  };

  const startContinuousManual = () => {
      if (uiStateRef.current !== "listening_continuous" && uiStateRef.current !== "listening") {
          residualRef.current = "";
          transcriptRef.current = "";
          setUiState("listening_continuous");
      }
  };

  // Listen for Rust backend hotkey
  useEffect(() => {
    let unlistenP: any;
    let isCancelled = false;
    const setup = async () => {
       const uP = await listen('hotkey_pressed', () => handleAltXPressed());
       if (isCancelled) {
           uP();
       } else {
           unlistenP = uP;
       }
    };
    setup();
    return () => {
       isCancelled = true;
       if (unlistenP) unlistenP();
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

  if (!isSetupComplete) return null;

  return (
    <div className="w-screen h-screen flex justify-center items-end pb-2 overflow-visible select-none bg-transparent font-display" data-tauri-drag-region>
      <div 
        className={`group relative flex items-center justify-center transition-all duration-300 ease-[cubic-bezier(0.16,1,0.3,1)] ${uiState === 'inactive' ? 'cursor-pointer' : ''}`}
        style={{
          width: uiState === 'inactive' ? '60px' : uiState === 'hover' ? '130px' : uiState === 'listening' ? '70px' : uiState === 'listening_continuous' ? '110px' : uiState === 'processing' ? '110px' : uiState === 'success' ? '80px' : '32px',
          height: uiState === 'inactive' ? '16px' : uiState === 'hover' ? '36px' : '28px',
        }}
        onClick={uiState === 'inactive' ? (e) => { e.stopPropagation(); startContinuousManual(); } : undefined}
        onMouseEnter={() => setUiState(prev => prev === 'inactive' ? 'hover' : prev)}
        onMouseLeave={() => setUiState(prev => prev === 'hover' ? 'inactive' : prev)}
      >
        
        {/* Main Pill Background (Hidden on hover so icons have their own circles) */}
        <div 
          className={`absolute backdrop-blur-3xl shadow-xl transition-all duration-300 ease-[cubic-bezier(0.16,1,0.3,1)] ${uiState === 'hover' ? 'opacity-0 scale-75 pointer-events-none' : 'opacity-100 scale-100'}`}
          style={{
             backgroundColor: pillColor === 'white' ? '#FFFFFF' : pillColor === 'yellow' ? '#FFD60A' : pillColor === 'orange' ? '#FF9F0A' : pillColor === 'purple' ? '#BF5AF2' : pillColor === 'pink' ? '#FF375F' : '#0A0A0A',
             border: uiState === 'inactive' 
                 ? (pillColor === 'white' ? '1px solid rgba(0,0,0,0.15)' : '1px solid rgba(255,255,255,0.7)') 
                 : '1px solid rgba(255,255,255,0.1)',
             width: '100%',
             height: '100%',
             borderRadius: '9999px',
             top: '0',
             left: '0'
          }}
        >
           {/* Logo removed entirely as per request */}
        </div>

        {/* Glow effect for processing */}
        {uiState === 'processing' && (
           <div className="absolute inset-0 rounded-full pointer-events-none transition-opacity duration-700 animate-pulse bg-primary/10 opacity-100" />
        )}

        {/* States Content (z-10 to stay above background) */}
        <div className="z-10 flex w-full h-full items-center justify-center">
          
          {/* Empty Inactive State */}
          {uiState === 'inactive' && (
             <div className="w-full h-full pointer-events-none"></div>
          )}

          {/* Hover State: 3 Separate Circles */}
          {uiState === 'hover' && (
            <div className="absolute inset-0 flex items-center justify-center gap-[8px]">
              <button 
                onClick={(e) => { e.stopPropagation(); setLangMode(prev => prev === 'auto' ? 'en' : prev === 'en' ? 'ta' : 'auto'); }} 
                className={`w-[28px] h-[28px] rounded-full bg-white/90 dark:bg-[#0A0A0A] shadow-md border border-black/5 dark:border-white/5 flex items-center justify-center cursor-pointer pointer-events-auto transition-transform hover:scale-110`}
              >
                {langMode === 'auto' && <span className="material-symbols-outlined text-[14px] text-[#1C1C1E] dark:text-[#F2F2F7]">language</span>}
                {langMode === 'en' && <span className="text-[10px] font-extrabold text-[#1C1C1E] dark:text-[#F2F2F7]">EN</span>}
                {langMode === 'ta' && <span className="text-[10px] font-extrabold text-[#1C1C1E] dark:text-[#F2F2F7]">TA</span>}
              </button>

              <button 
                onClick={(e) => { e.stopPropagation(); startContinuousManual(); }} 
                className={`w-[36px] h-[36px] rounded-full bg-white/90 dark:bg-[#0A0A0A] shadow-md border border-black/5 dark:border-white/5 flex items-center justify-center cursor-pointer pointer-events-auto transition-transform hover:scale-110`}
              >
                <span className="material-symbols-outlined text-[20px] text-[#1C1C1E] dark:text-[#F2F2F7]">headset_mic</span>
              </button>

              <button 
                onClick={(e) => { e.stopPropagation(); openDashboard(); }} 
                className={`w-[28px] h-[28px] rounded-full bg-white/90 dark:bg-[#0A0A0A] shadow-md border border-black/5 dark:border-white/5 flex items-center justify-center cursor-pointer pointer-events-auto transition-transform hover:scale-110`}
              >
                <span className="material-symbols-outlined text-[14px] text-[#1C1C1E] dark:text-[#F2F2F7]">settings</span>
              </button>
            </div>
          )}

          {uiState === 'listening' && (
             <div className="relative flex items-center justify-center w-full px-2 pointer-events-none">
              <div className="flex items-center gap-[3px] h-4">
                 {/* Voice tracked soundwave */}
                <div className="w-[2px] bg-[#8E8E93] rounded-full transition-all duration-75" style={{ height: `${Math.max(3, volumes[0] * 20)}px` }}></div>
                <div className="w-[2px] bg-[#D1D1D6] rounded-full transition-all duration-75" style={{ height: `${Math.max(3, volumes[1] * 24)}px` }}></div>
                <div className="w-[2px] bg-white rounded-full transition-all duration-75" style={{ height: `${Math.max(3, volumes[2] * 28)}px` }}></div>
                <div className="w-[2px] bg-[#D1D1D6] rounded-full transition-all duration-75" style={{ height: `${Math.max(3, volumes[3] * 24)}px` }}></div>
                <div className="w-[2px] bg-[#8E8E93] rounded-full transition-all duration-75" style={{ height: `${Math.max(3, volumes[4] * 20)}px` }}></div>
              </div>
             </div>
          )}

          {uiState === 'listening_continuous' && (
            <div className="relative flex items-center justify-between w-full px-[3px] pointer-events-auto">
              <button 
                  onClick={(e) => { e.stopPropagation(); cancelSendRef.current = true; mainRec.current?.stop(); }}
                  className="w-5 h-5 rounded-full flex items-center justify-center bg-[#4A4A4C] hover:bg-[#5A5A5C] text-white transition-colors cursor-pointer"
              >
                  <span className="material-symbols-outlined text-[12px] font-extrabold">close</span>
              </button>
              
              <div className="flex items-center gap-[3px] h-4">
                 {/* Voice tracked soundwave */}
                <div className="w-[2px] bg-[#8E8E93] rounded-full transition-all duration-75" style={{ height: `${Math.max(3, volumes[0] * 20)}px` }}></div>
                <div className="w-[2px] bg-[#D1D1D6] rounded-full transition-all duration-75" style={{ height: `${Math.max(3, volumes[1] * 24)}px` }}></div>
                <div className="w-[2px] bg-white rounded-full transition-all duration-75" style={{ height: `${Math.max(3, volumes[2] * 28)}px` }}></div>
                <div className="w-[2px] bg-[#D1D1D6] rounded-full transition-all duration-75" style={{ height: `${Math.max(3, volumes[3] * 24)}px` }}></div>
                <div className="w-[2px] bg-[#8E8E93] rounded-full transition-all duration-75" style={{ height: `${Math.max(3, volumes[4] * 20)}px` }}></div>
              </div>

              <button 
                  onClick={(e) => { e.stopPropagation(); mainRec.current?.stop(); }}
                  className="w-5 h-5 rounded-full flex items-center justify-center bg-white hover:bg-gray-200 text-black transition-colors cursor-pointer"
              >
                  <span className="material-symbols-outlined text-[12px] font-extrabold" style={{ strokeWidth: 3 }}>check</span>
              </button>
            </div>
          )}

          {uiState === 'processing' && (
            <div className="flex items-center gap-2 pointer-events-none">
              <img src="/logo.png" className="w-[14px] h-[14px] object-contain dark:invert animate-pulse" alt="Lisa Logo" />
              <span className="text-[11px] font-bold tracking-wide text-[#1C1C1E] dark:text-[#F2F2F7]">Processing...</span>
            </div>
          )}

          {uiState === 'success' && (
            <div className="flex items-center gap-1.5 pointer-events-none text-emerald-600">
              <span className="material-symbols-outlined text-[14px]">check_circle</span>
              <span className="text-[11px] font-bold tracking-wide">Inserted</span>
            </div>
          )}



        </div>
      </div>
    </div>
  );
}
