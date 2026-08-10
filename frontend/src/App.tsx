import { useState, useEffect, useRef } from "react";
import { Command } from '@tauri-apps/plugin-shell';
import { invoke } from '@tauri-apps/api/core';
import { getCurrentWindow, currentMonitor, PhysicalSize, PhysicalPosition } from '@tauri-apps/api/window';
import "./App.css";

declare global {
  interface Window {
    webkitSpeechRecognition: any;
  }
}

type UIState = "idle" | "listening" | "processing";
type TabState = "assistant" | "history" | "settings";

function App() {
  const [uiState, setUiState] = useState<UIState>("idle");
  const [activeTab, setActiveTab] = useState<TabState>("assistant");
  const [duration, setDuration] = useState(0);
  const [historyLog, setHistoryLog] = useState<{title: string, desc: string, time: string}[]>([]);
  const [stats, setStats] = useState({ totalWords: "0", timeSaved: "0m", dictationCount: 0 });
  const [apiKeys, setApiKeys] = useState<Record<string, string>>({});
  const [newProvider, setNewProvider] = useState("");
  const [newKeyValue, setNewKeyValue] = useState("");
  const [isSavingKey, setIsSavingKey] = useState(false);
  const [processingMode, setProcessingMode] = useState("Grammar Correction");
  const [isModeDropdownOpen, setIsModeDropdownOpen] = useState(false);
  const [isAppFullscreen, setIsAppFullscreen] = useState(false);
  const [savedBounds, setSavedBounds] = useState<{width: number, height: number, x: number, y: number} | null>(null);
  
  const ws = useRef<WebSocket | null>(null);
  const mainRec = useRef<any>(null);
  const silenceTimer = useRef<any>(null);
  const durationTimer = useRef<any>(null);
  const transcriptRef = useRef<string>("");
  const residualRef = useRef<string>("");
  
  // Sidecar Launch & Data Fetching
  useEffect(() => {
    const launchSidecar = async () => {
      try {
        const command = Command.sidecar('bin/backend');
        const child = await command.spawn();
        console.log('Sidecar spawned with PID:', child.pid);
        
        // Wait for sidecar to boot before fetching
        setTimeout(() => {
           fetch("http://127.0.0.1:8000/api/settings")
             .then(res => res.json())
             .then(data => {
                setApiKeys(data.api_keys || {});
                setProcessingMode(data.processing_mode || "Grammar Correction");
                if (data.theme === "dark") document.body.classList.add("dark");
             }).catch(e => console.error(e));
             
           refreshData();
        }, 3000);
      } catch (err) {
        console.error('Failed to spawn sidecar:', err);
      }
    };
    launchSidecar();
  }, []);
  
  const refreshData = async () => {
      try {
          const histRes = await fetch("http://127.0.0.1:8000/api/history");
          const histData = await histRes.json();
          setHistoryLog(histData);
          
          const statsRes = await fetch("http://127.0.0.1:8000/api/stats");
          const statsData = await statsRes.json();
          setStats(statsData);
      } catch(e) { console.error("Data refresh failed", e) }
  };

  const handleClearHistory = async () => {
      try {
          await fetch("http://127.0.0.1:8000/api/history", { method: 'DELETE' });
          refreshData();
      } catch(e) {}
  };
  
  const handleMaximize = async () => {
      try {
          const appWindow = getCurrentWindow();
          if (isAppFullscreen) {
              if (savedBounds) {
                  await appWindow.setSize(new PhysicalSize(savedBounds.width, savedBounds.height));
                  await appWindow.setPosition(new PhysicalPosition(savedBounds.x, savedBounds.y));
              }
              setIsAppFullscreen(false);
          } else {
              const size = await appWindow.outerSize();
              const pos = await appWindow.outerPosition();
              setSavedBounds({ width: size.width, height: size.height, x: pos.x, y: pos.y });
              
              const monitor = await currentMonitor();
              if (monitor) {
                  await appWindow.setPosition(new PhysicalPosition(monitor.position.x, monitor.position.y));
                  await appWindow.setSize(new PhysicalSize(monitor.size.width, monitor.size.height));
              }
              setIsAppFullscreen(true);
          }
      } catch(e) { console.error(e) }
  };
  
  const handleSaveSettings = async (overrideMode?: string) => {
      setIsSavingKey(true);
      try {
          await fetch("http://127.0.0.1:8000/api/settings", {
              method: "POST",
              headers: { "Content-Type": "application/json" },
              body: JSON.stringify({
                  api_keys: apiKeys,
                  theme: document.body.classList.contains("dark") ? "dark" : "light",
                  processing_mode: overrideMode || processingMode
              })
          });
      } catch(e) {}
      setIsSavingKey(false);
  };

  const handleModeChange = (mode: string) => {
      setProcessingMode(mode);
      handleSaveSettings(mode);
      setIsModeDropdownOpen(false);
  };
  
  const handleThemeChange = async (theme: string) => {
      if (theme === "dark") {
          document.body.classList.add("dark");
      } else {
          document.body.classList.remove("dark");
      }
      try {
        await invoke('broadcast_theme', { theme });
      } catch(e) {}
      setTimeout(handleSaveSettings, 100);
  };
  
  const handleAddKey = async () => {
      if (!newProvider || !newKeyValue) return;
      const updatedKeys = { ...apiKeys, [newProvider.toLowerCase()]: newKeyValue };
      setApiKeys(updatedKeys);
      setNewProvider("");
      setNewKeyValue("");
      // Need to trigger save after state update, but state update is async.
      setIsSavingKey(true);
      try {
          await fetch("http://127.0.0.1:8000/api/settings", {
              method: "POST",
              headers: { "Content-Type": "application/json" },
              body: JSON.stringify({
                  api_keys: updatedKeys,
                  theme: document.body.classList.contains("dark") ? "dark" : "light"
              })
          });
      } catch(e) {}
      setIsSavingKey(false);
  };

  const handleRemoveKey = async (provider: string) => {
      const updatedKeys = { ...apiKeys };
      delete updatedKeys[provider];
      setApiKeys(updatedKeys);
      
      try {
          await fetch("http://127.0.0.1:8000/api/settings", {
              method: "POST",
              headers: { "Content-Type": "application/json" },
              body: JSON.stringify({
                  api_keys: updatedKeys,
                  theme: document.body.classList.contains("dark") ? "dark" : "light"
              })
          });
      } catch(e) {}
  };

  // Theme Toggler
  useEffect(() => {
    const handleContextMenu = (e: MouseEvent) => {
      e.preventDefault();
      document.body.classList.toggle("dark");
    };
    document.addEventListener("contextmenu", handleContextMenu);
    return () => document.removeEventListener("contextmenu", handleContextMenu);
  }, []);

  // WebSocket
  useEffect(() => {
    ws.current = new WebSocket("ws://127.0.0.1:8000/ws/lisa");
    
    ws.current.onmessage = (event) => {
        try {
            const data = JSON.parse(event.data);
            if (data.type === "message" && data.content.startsWith("Typed:")) {
                setUiState("idle");
                // Refresh data from backend to get updated stats and history
                setTimeout(refreshData, 500);
            } else if (data.type === "toggle_mic") {
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
        } catch(e) {}
    };

    return () => ws.current?.close();
  }, []);

  // Duration Timer
  useEffect(() => {
    if (uiState === "listening") {
      setDuration(0);
      durationTimer.current = setInterval(() => {
        setDuration(d => d + 1);
      }, 1000);
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
    } else {
      if (durationTimer.current) clearInterval(durationTimer.current);
    }
    
    return () => {
      if (durationTimer.current) clearInterval(durationTimer.current);
    }
  }, [uiState]);



  // Speech Recognition
  useEffect(() => {
    if (!('webkitSpeechRecognition' in window)) {
      console.warn("Speech Recognition API not supported.");
      return;
    }

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
          
          setUiState("processing");
          if (silenceTimer.current) clearTimeout(silenceTimer.current);
          
          const finalStr = transcriptRef.current.trim();
          if (finalStr && ws.current && ws.current.readyState === WebSocket.OPEN) {
            ws.current.send(finalStr);
          } else {
             setUiState("idle");
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

  return (
    <div className={`h-screen w-screen bg-transparent flex justify-center items-center overflow-hidden selection:bg-black/20 dark:selection:bg-white/20 selection:text-black dark:selection:text-white ${isAppFullscreen ? 'p-0' : 'p-4'}`}>
      <div className={`flex h-full w-full relative bg-white dark:bg-black text-[#1C1C1E] dark:text-white font-body-md overflow-hidden shadow-[0_20px_60px_rgba(0,0,0,0.15)] border border-[#E5E5EA] dark:border-white/10 ${isAppFullscreen ? 'rounded-none border-none' : 'rounded-[24px]'}`}>
        {/* Background Ambient Effects (Removed for clean white theme) */}
  
        {/* SideNavBar */}
        <nav className="hidden md:flex w-64 h-full border-r border-[#E5E5EA] dark:border-white/10 bg-[#F2F2F7] dark:bg-[#111111]/50 flex-col py-6 px-6 gap-y-6 z-10 shrink-0">
          
          {/* macOS Controls */}
          <div className="flex gap-2 mb-2 items-center group/mac" data-tauri-drag-region>
            <button onClick={() => invoke('hide_dashboard')} className="w-3 h-3 rounded-full bg-[#ff5f56] border border-[#e0443e] flex items-center justify-center flex-shrink-0 cursor-pointer">
              <svg className="w-2 h-2 text-black/60 opacity-0 group-hover/mac:opacity-100 transition-opacity" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="3.5" strokeLinecap="round" strokeLinejoin="round"><path d="M18 6L6 18M6 6l12 12"/></svg>
            </button>
            <button onClick={() => invoke('minimize_dashboard')} className="w-3 h-3 rounded-full bg-[#ffbd2e] border border-[#dea123] flex items-center justify-center flex-shrink-0 cursor-pointer">
              <svg className="w-2 h-2 text-black/60 opacity-0 group-hover/mac:opacity-100 transition-opacity" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="3.5" strokeLinecap="round" strokeLinejoin="round"><path d="M5 12h14"/></svg>
            </button>
            <button onClick={handleMaximize} className="w-3 h-3 rounded-full bg-[#27c93f] border border-[#1aab29] flex items-center justify-center flex-shrink-0 cursor-pointer">
              <svg className="w-[7px] h-[7px] text-black/60 opacity-0 group-hover/mac:opacity-100 transition-opacity" viewBox="0 0 24 24" fill="currentColor" stroke="none">
                {isAppFullscreen ? (
                  <path d="M4 10h6V4L4 10zM20 14h-6v6L20 14z" />
                ) : (
                  <path d="M4 4h9L4 13zM20 20h-9L20 11z" />
                )}
              </svg>
            </button>
          </div>
          
          <div className="flex flex-col gap-1 px-2 mb-6">
            <div className="flex items-center gap-3">
              <img src="/logo.png" className="w-8 h-8 object-contain dark:invert" alt="Lisa Flow Logo" />
              <h1 className="font-display text-[26px] dark:text-white text-black font-bold tracking-tight">Lisa Flow</h1>
            </div>
            <p className="font-label-sm text-label-sm text-black/50 dark:text-white/50">Premium Voice</p>
          </div>
        
        <ul className="flex flex-col gap-2 flex-grow">
          <li>
            <a onClick={() => setActiveTab('assistant')} className={`flex items-center gap-3 px-4 py-3 rounded-full transition-all duration-300 cursor-pointer border ${activeTab === 'assistant' ? 'bg-gradient-to-r from-black/80 to-black/60 dark:from-white/10 dark:to-white/5 backdrop-blur-xl border-white/20 dark:border-white/10 shadow-[0_8px_24px_rgba(0,0,0,0.15)] dark:shadow-[0_8px_24px_rgba(255,255,255,0.05)] text-white font-bold scale-95' : 'border-transparent text-black/60 dark:text-white/60 hover:bg-black/5 dark:hover:bg-white/10 hover:backdrop-blur-md hover:text-black dark:hover:text-white'}`}>
              <span className="material-symbols-outlined" style={{fontVariationSettings: "'FILL' 1"}}>mic</span>
              <span className="font-label-sm text-label-sm">Assistant</span>
            </a>
          </li>
          <li>
            <a onClick={() => setActiveTab('history')} className={`flex items-center gap-3 px-4 py-3 rounded-full transition-all duration-300 cursor-pointer border ${activeTab === 'history' ? 'bg-gradient-to-r from-black/80 to-black/60 dark:from-white/10 dark:to-white/5 backdrop-blur-xl border-white/20 dark:border-white/10 shadow-[0_8px_24px_rgba(0,0,0,0.15)] dark:shadow-[0_8px_24px_rgba(255,255,255,0.05)] text-white font-bold scale-95' : 'border-transparent text-black/60 dark:text-white/60 hover:bg-black/5 dark:hover:bg-white/10 hover:backdrop-blur-md hover:text-black dark:hover:text-white'}`}>
              <span className="material-symbols-outlined">history</span>
              <span className="font-label-sm text-label-sm">History</span>
            </a>
          </li>
          <li>
            <a onClick={() => setActiveTab('settings')} className={`flex items-center gap-3 px-4 py-3 rounded-full transition-all duration-300 cursor-pointer border ${activeTab === 'settings' ? 'bg-gradient-to-r from-black/80 to-black/60 dark:from-white/10 dark:to-white/5 backdrop-blur-xl border-white/20 dark:border-white/10 shadow-[0_8px_24px_rgba(0,0,0,0.15)] dark:shadow-[0_8px_24px_rgba(255,255,255,0.05)] text-white font-bold scale-95' : 'border-transparent text-black/60 dark:text-white/60 hover:bg-black/5 dark:hover:bg-white/10 hover:backdrop-blur-md hover:text-black dark:hover:text-white'}`}>
              <span className="material-symbols-outlined">settings</span>
              <span className="font-label-sm text-label-sm">Settings</span>
            </a>
          </li>
        </ul>
      </nav>

      {/* Main Content Area */}
      <main className="flex-1 flex flex-col h-full overflow-hidden relative z-10 bg-white dark:bg-black">
        <header className="flex justify-between items-center px-8 w-full max-w-[1440px] mx-auto h-16 top-0 shrink-0 mt-8 md:mt-12 md:px-margin" data-tauri-drag-region>
          <div className="md:hidden">
            <div className="flex items-center gap-2">
              <img src="/logo.png" className="w-6 h-6 object-contain dark:invert" alt="Lisa Flow Logo" />
              <h1 className="font-display text-headline-md text-[#1C1C1E] dark:text-white font-bold">Lisa Flow</h1>
            </div>
          </div>
          <div className="hidden md:flex flex-col pointer-events-none">
            <h2 className="font-display text-display text-[#1C1C1E] dark:text-white tracking-tight font-medium">Good Morning</h2>
            <div className="flex items-center gap-2 mt-1">
              <div className={`w-2 h-2 rounded-full ${uiState === 'idle' ? 'bg-emerald-500' : 'dark:bg-white bg-black dark:text-black text-white'} animate-pulse`}></div>
              <span className="font-label-sm text-label-sm text-[#8E8E93] dark:text-gray-400 font-medium">System Status: {uiState}</span>
            </div>
          </div>
          <div className="flex items-center gap-4">
            {/* Removed notification and profile placeholder for a cleaner UI */}
          </div>
        </header>

        {/* Scrollable Content */}
        <div className="flex-1 overflow-y-auto px-4 md:px-margin pb-12 w-full max-w-[1440px] mx-auto">
          {activeTab === 'assistant' && (
            <div className="grid grid-cols-1 lg:grid-cols-12 gap-gutter mt-8">
              <div className="lg:col-span-8 flex flex-col gap-gutter">
                {/* Primary Action Card */}
                <div onClick={toggleMic} className={`relative overflow-hidden rounded-[24px] bg-[#F2F2F7] dark:bg-[#111111] border ${uiState === 'listening' ? 'dark:border-white border-black' : 'border-[#E5E5EA] dark:border-white/10'} p-10 flex flex-col items-center justify-center min-h-[320px] group cursor-pointer transition-transform duration-500 hover:scale-[1.01]`}>
                  <div className="absolute inset-0 bg-gradient-to-br from-primary/5 to-transparent opacity-0 group-hover:opacity-100 transition-opacity duration-500"></div>
                  
                  {uiState === 'idle' && (
                    <>
                      <div className="relative z-10 w-24 h-24 rounded-full bg-white dark:bg-black flex items-center justify-center shadow-[0_8px_30px_rgba(0,0,0,0.08)] mb-6 group-hover:scale-110 transition-transform duration-500 ease-out border border-[#E5E5EA] dark:border-white/10">
                        <span className="material-symbols-outlined dark:text-white text-black text-4xl" style={{fontVariationSettings: "'FILL' 1"}}>mic</span>
                      </div>
                      <h3 className="font-headline-md text-[24px] font-semibold text-[#1C1C1E] dark:text-white mb-2 relative z-10">Start Dictation</h3>
                      <p className="font-body-md text-body-md text-[#8E8E93] dark:text-gray-400 text-center max-w-sm relative z-10">Click or press Alt+X from any app to begin translating your thoughts into precise text.</p>
                    </>
                  )}

                  {uiState === 'listening' && (
                    <>
                      <div className="relative z-10 w-24 h-24 rounded-full bg-error flex items-center justify-center shadow-[0_0_40px_rgba(186,26,26,0.3)] mb-6 animate-pulse">
                        <span className="material-symbols-outlined text-on-primary text-4xl" style={{fontVariationSettings: "'FILL' 1"}}>mic</span>
                        <div className="absolute inset-0 rounded-full border-2 border-error/50 animate-ping"></div>
                      </div>
                      <h3 className="font-headline-md text-headline-md text-on-surface mb-2 relative z-10">Listening...</h3>
                      <p className="font-body-md text-body-md dark:text-white text-black text-center max-w-sm relative z-10">{formatDuration(duration)}</p>
                    </>
                  )}

                  {uiState === 'processing' && (
                    <>
                      <div className="relative z-10 w-24 h-24 rounded-full bg-black/10 dark:bg-white/20 flex items-center justify-center shadow-[0_0_40px_rgba(0,0,0,0.2)] dark:shadow-[0_0_40px_rgba(255,255,255,0.2)] mb-6 animate-spin">
                        <span className="material-symbols-outlined dark:text-white text-black text-4xl" style={{fontVariationSettings: "'FILL' 1"}}>progress_activity</span>
                      </div>
                      <h3 className="font-headline-md text-headline-md text-on-surface mb-2 relative z-10">Understanding...</h3>
                      <p className="font-body-md text-body-md text-on-surface-variant text-center max-w-sm relative z-10">Lisa Flow is refining your thoughts.</p>
                    </>
                  )}
                </div>

                {/* Statistics Grid */}
                <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
                  <div className="bg-[#F2F2F7] dark:bg-[#111111] border border-[#E5E5EA] dark:border-white/10 rounded-[20px] p-6 flex flex-col gap-2 relative overflow-hidden">
                    <span className="material-symbols-outlined text-[#8E8E93] dark:text-gray-400 text-sm">text_snippet</span>
                    <span className="font-display text-headline-lg text-[#1C1C1E] dark:text-white font-bold tracking-tight">{stats.totalWords}</span>
                    <span className="font-label-sm text-[12px] text-[#8E8E93] dark:text-gray-400 uppercase tracking-wider font-semibold">Total Words</span>
                  </div>
                  <div className="bg-[#F2F2F7] dark:bg-[#111111] border border-[#E5E5EA] dark:border-white/10 rounded-[20px] p-6 flex flex-col gap-2 relative overflow-hidden">
                    <span className="material-symbols-outlined text-[#8E8E93] dark:text-gray-400 text-sm">history_edu</span>
                    <span className="font-display text-headline-lg text-[#1C1C1E] dark:text-white font-bold tracking-tight">{stats.dictationCount}</span>
                    <span className="font-label-sm text-[12px] text-[#8E8E93] dark:text-gray-400 uppercase tracking-wider font-semibold">Dictations</span>
                  </div>
                  <div className="bg-[#F2F2F7] dark:bg-[#111111] border border-[#E5E5EA] dark:border-white/10 rounded-[20px] p-6 flex flex-col gap-2 relative overflow-hidden">
                    <span className="material-symbols-outlined text-[#8E8E93] dark:text-gray-400 text-sm">schedule</span>
                    <span className="font-display text-headline-lg text-[#1C1C1E] dark:text-white font-bold tracking-tight">{stats.timeSaved}</span>
                    <span className="font-label-sm text-[12px] text-[#8E8E93] dark:text-gray-400 uppercase tracking-wider font-semibold">Time Saved</span>
                  </div>
                </div>
              </div>

              {/* Recent Transcriptions */}
              <div className="lg:col-span-4 flex flex-col">
                <div className="flex items-center justify-between mb-6">
                  <h3 className="font-headline-md text-[20px] font-semibold text-[#1C1C1E] dark:text-white">Recent</h3>
                  <button onClick={() => setActiveTab('history')} className="font-label-sm text-label-sm dark:text-white text-black hover:dark:text-white text-black-container transition-colors">View All</button>
                </div>
                <div className="flex flex-col gap-3">
                  {historyLog.slice(0,3).map((log, i) => (
                    <div key={i} className="group bg-[#F2F2F7] dark:bg-[#111111] border border-[#E5E5EA] dark:border-white/10 hover:border-[#D1D1D6] dark:border-white/20 transition-all duration-300 rounded-[20px] p-4 cursor-pointer">
                      <div className="flex items-start justify-between gap-4">
                        <div className="w-10 h-10 rounded-full bg-white dark:bg-black border border-[#E5E5EA] dark:border-white/10 flex items-center justify-center shrink-0 group-hover:dark:border-white border-black/30 transition-colors">
                          <span className="material-symbols-outlined text-[#8E8E93] dark:text-gray-400 text-sm group-hover:dark:text-white text-black">description</span>
                        </div>
                        <div className="flex-1 min-w-0">
                          <h4 className="font-label-sm text-label-sm font-semibold text-[#1C1C1E] dark:text-white truncate mb-1">{log.title}</h4>
                          <p className="font-body-md text-[13px] leading-tight text-[#3A3A3C] dark:text-gray-500 line-clamp-2">{log.desc}</p>
                        </div>
                        <span className="font-label-sm text-[11px] text-[#8E8E93] dark:text-gray-400 shrink-0 font-medium">{log.time}</span>
                      </div>
                    </div>
                  ))}
                  {historyLog.length === 0 && (
                     <div className="text-[#8E8E93] dark:text-gray-400 text-sm p-4 text-center">No recent dictations.</div>
                  )}
                </div>
              </div>
            </div>
          )}

          {activeTab === 'settings' && (
             <div className="mt-8 space-y-6">
                <h3 className="font-display text-headline-lg text-[#1C1C1E] dark:text-white mb-4">Settings</h3>
                
                {/* General Settings */}
                <div className="bg-[#F2F2F7] dark:bg-[#111111] border border-[#E5E5EA] dark:border-white/10 rounded-[20px] p-6">
                   <h4 className="font-headline-md text-[#1C1C1E] dark:text-white mb-2 font-semibold">General Settings</h4>
                   <p className="text-sm text-[#8E8E93] dark:text-gray-400 mb-4">Customize the AI processing mode and writing style.</p>
                   
                   <div className="flex flex-col gap-2">
                     <label className="text-sm font-semibold text-[#1C1C1E] dark:text-white">Processing Mode</label>
                     <div className="relative">
                       <button 
                         onClick={() => setIsModeDropdownOpen(!isModeDropdownOpen)}
                         className="w-full flex items-center justify-between px-4 py-3 rounded-xl bg-white dark:bg-[#1C1C1E] border border-[#E5E5EA] dark:border-white/10 text-[#1C1C1E] dark:text-white text-sm font-medium transition-all hover:border-black/20 dark:hover:border-white/30"
                       >
                         <span>{processingMode}</span>
                         <span className={`material-symbols-outlined text-[18px] transition-transform duration-300 ${isModeDropdownOpen ? 'rotate-180' : ''}`}>expand_more</span>
                       </button>
                       
                       {isModeDropdownOpen && (
                         <>
                           <div className="fixed inset-0 z-10" onClick={() => setIsModeDropdownOpen(false)}></div>
                           <div className="absolute top-full left-0 w-full mt-2 bg-white dark:bg-[#1C1C1E] border border-[#E5E5EA] dark:border-white/10 rounded-xl shadow-[0_10px_30px_rgba(0,0,0,0.05)] dark:shadow-[0_10px_30px_rgba(0,0,0,0.4)] z-20 overflow-hidden py-1 transform origin-top animate-in fade-in slide-in-from-top-2 duration-200">
                             {['Grammar Correction', 'Prompt Writing', 'Formal / Academic', 'Casual'].map(mode => (
                               <button
                                 key={mode}
                                 onClick={() => handleModeChange(mode)}
                                 className="w-full text-left px-4 py-2.5 text-sm text-[#1C1C1E] dark:text-white hover:bg-[#F2F2F7] dark:hover:bg-white/5 transition-colors flex items-center justify-between"
                               >
                                  {mode}
                                  {processingMode === mode && <span className="material-symbols-outlined text-[16px] text-[#1C1C1E] dark:text-white">check</span>}
                               </button>
                             ))}
                           </div>
                         </>
                       )}
                     </div>
                   </div>
                </div>

                <div className="bg-[#F2F2F7] dark:bg-[#111111] border border-[#E5E5EA] dark:border-white/10 rounded-[20px] p-6">
                   <h4 className="font-headline-md text-[#1C1C1E] dark:text-white mb-2 font-semibold">API Key Vault</h4>
                   <p className="text-sm text-[#8E8E93] dark:text-gray-400 mb-6">Securely manage API keys for various AI providers (Gemini, OpenAI, Anthropic).</p>
                   
                   {/* Key List */}
                   <div className="flex flex-col gap-3 mb-6">
                     {Object.entries(apiKeys).length === 0 ? (
                       <div className="text-sm text-[#8E8E93] dark:text-gray-400 italic">No keys configured yet.</div>
                     ) : (
                       Object.entries(apiKeys).map(([provider, val]) => (
                         <div key={provider} className="flex items-center justify-between bg-white dark:bg-black border border-[#E5E5EA] dark:border-white/10 p-3 rounded-xl">
                           <div className="flex flex-col">
                             <span className="font-semibold text-sm capitalize text-[#1C1C1E] dark:text-white">{provider}</span>
                             <span className="font-mono text-xs text-[#8E8E93] dark:text-gray-400">••••••••{val.slice(-4)}</span>
                           </div>
                           <button onClick={() => handleRemoveKey(provider)} className="w-8 h-8 rounded-lg hover:bg-error/10 text-[#8E8E93] dark:text-gray-400 hover:text-error flex items-center justify-center transition-colors">
                             <span className="material-symbols-outlined text-sm">delete</span>
                           </button>
                         </div>
                       ))
                     )}
                   </div>

                   {/* Add Key Form */}
                   <div className="flex gap-3 items-center mt-2 border-t border-[#E5E5EA] dark:border-white/10 pt-6">
                     <input type="text" placeholder="Provider (e.g. gemini)" value={newProvider} onChange={e => setNewProvider(e.target.value)} className="w-1/3 px-4 py-2.5 rounded-xl bg-white dark:bg-black border border-[#E5E5EA] dark:border-white/10 focus:outline-none focus:dark:border-white border-black text-[#1C1C1E] dark:text-white shadow-sm text-sm" />
                     <input type="password" placeholder="Enter API Key" value={newKeyValue} onChange={e => setNewKeyValue(e.target.value)} className="flex-1 px-4 py-2.5 rounded-xl bg-white dark:bg-black border border-[#E5E5EA] dark:border-white/10 focus:outline-none focus:dark:border-white border-black text-[#1C1C1E] dark:text-white shadow-sm text-sm" />
                     <button onClick={handleAddKey} disabled={isSavingKey || !newProvider || !newKeyValue} className="dark:bg-white bg-black dark:text-black text-white text-white px-5 py-2.5 rounded-xl text-sm font-semibold hover:dark:bg-white bg-black dark:text-black text-white/90 transition-colors shadow-sm disabled:opacity-50">
                        {isSavingKey ? "Saving..." : "Add"}
                     </button>
                   </div>
                </div>
                
                <div className="bg-[#F2F2F7] dark:bg-[#111111] border border-[#E5E5EA] dark:border-white/10 rounded-[20px] p-6 mt-6">
                   <h4 className="font-headline-md text-[#1C1C1E] dark:text-white mb-2 font-semibold">Theme</h4>
                   <p className="text-sm text-[#8E8E93] dark:text-gray-400 mb-4">Choose your preferred appearance.</p>
                   <div className="flex gap-4">
                     <div className="flex p-[4px] bg-[#E5E5EA]/80 dark:bg-white/5 rounded-full relative w-[184px] border border-black/5 dark:border-white/10 shadow-inner backdrop-blur-md">
                         {/* Sliding Background Indicator */}
                         <div className="absolute top-[4px] bottom-[4px] left-[4px] w-[88px] bg-white dark:bg-[#2C2C2E] rounded-full shadow-[0_2px_8px_rgba(0,0,0,0.08)] transition-transform duration-500 ease-[cubic-bezier(0.16,1,0.3,1)] translate-x-0 dark:translate-x-[88px] border border-black/5 dark:border-white/10"></div>
                         
                         <button onClick={() => handleThemeChange('light')} className="relative w-[88px] h-[32px] flex items-center justify-center gap-1.5 z-10 font-semibold text-[13px] transition-colors duration-300 text-[#1C1C1E] dark:text-white/50 hover:text-black dark:hover:text-white/80">
                             <span className="material-symbols-outlined text-[16px]">light_mode</span>
                             Light
                         </button>
                         
                         <button onClick={() => handleThemeChange('dark')} className="relative w-[88px] h-[32px] flex items-center justify-center gap-1.5 z-10 font-semibold text-[13px] transition-colors duration-300 text-black/50 dark:text-white hover:text-black/80 dark:hover:text-white">
                             <span className="material-symbols-outlined text-[16px]">dark_mode</span>
                             Dark
                         </button>
                     </div>
                   </div>
                </div>
             </div>
          )}

          {activeTab === 'history' && (
             <div className="mt-8">
                <div className="flex justify-between items-center mb-4">
                  <h3 className="font-display text-headline-lg">Full History</h3>
                  {historyLog.length > 0 && (
                    <button onClick={handleClearHistory} className="text-error hover:text-error/80 text-sm font-semibold px-3 py-1.5 rounded-lg hover:bg-error/10 transition-colors flex items-center gap-1">
                      <span className="material-symbols-outlined text-[18px]">delete</span>
                      Clear History
                    </button>
                  )}
                </div>
                <div className="flex flex-col gap-3">
                  {historyLog.map((log, i) => (
                    <div key={i} className="bg-[#F2F2F7] dark:bg-[#111111] border border-[#E5E5EA] dark:border-white/10 rounded-[20px] p-4">
                      <div className="flex items-start justify-between gap-4">
                        <div className="flex-1 min-w-0">
                          <h4 className="font-label-sm font-semibold text-[#1C1C1E] dark:text-white mb-1">{log.title}</h4>
                          <p className="font-body-md text-sm text-[#3A3A3C] dark:text-gray-500">{log.desc}</p>
                        </div>
                        <span className="font-label-sm text-[12px] text-[#8E8E93] dark:text-gray-400 font-medium">{log.time}</span>
                      </div>
                    </div>
                  ))}
                  {historyLog.length === 0 && (
                     <div className="text-[#8E8E93] dark:text-gray-400 text-sm">No history available yet.</div>
                  )}
                </div>
             </div>
          )}

        </div>
      </main>
      </div>
    </div>
  );
}

export default App;
