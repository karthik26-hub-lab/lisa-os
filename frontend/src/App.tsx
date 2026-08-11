import { useState, useEffect, useRef } from "react";
import { listen } from '@tauri-apps/api/event';
import { Command } from '@tauri-apps/plugin-shell';
import { invoke } from '@tauri-apps/api/core';
import { playChime, playSnap, playAlarm } from './utils/audio';
import { getCurrentWindow, currentMonitor, PhysicalSize, PhysicalPosition } from '@tauri-apps/api/window';
import "./App.css";

declare global {
  interface Window {
    webkitSpeechRecognition: any;
  }
}

type UIState = "idle" | "listening" | "processing" | "error";
type TabState = "assistant" | "history" | "settings" | "notepad" | "memory";

export type NotepadState = "normal" | "minimized" | "maximized";
export interface Notepad {
    id: number;
    content: string;
    state: NotepadState;
}

const Dropdown = ({ value, options, onChange, placeholder, className }: { value: string, options: string[], onChange: (v: string) => void, placeholder?: string, className?: string }) => {
  const [isOpen, setIsOpen] = useState(false);
  const dropdownRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const handleClickOutside = (event: MouseEvent) => {
      if (dropdownRef.current && !dropdownRef.current.contains(event.target as Node)) {
        setIsOpen(false);
      }
    };
    document.addEventListener("mousedown", handleClickOutside);
    return () => document.removeEventListener("mousedown", handleClickOutside);
  }, []);

  return (
    <div ref={dropdownRef} className={`relative ${className || 'w-full'}`}>
      <div 
        onClick={() => setIsOpen(!isOpen)}
        className={`w-full px-4 py-2.5 rounded-xl bg-[#FDFBF7] dark:bg-[#151413] border border-[#EAE5D9] dark:border-[#3A3631] text-[#1C1C1E] dark:text-white shadow-sm text-sm cursor-pointer flex justify-between items-center transition-colors ${isOpen ? 'border-black dark:border-white' : ''}`}
      >
        <span className="truncate">{value || placeholder}</span>
        <span className="material-symbols-outlined text-[16px] text-[#8E8E93]">expand_more</span>
      </div>
      
      {isOpen && (
        <div className="absolute top-full left-0 mt-2 w-full max-h-60 overflow-y-auto bg-[#FDFBF7] dark:bg-[#272421] border border-[#EAE5D9] dark:border-[#3A3631] rounded-xl shadow-xl z-50 py-1 animate-in fade-in zoom-in-95 duration-200">
          {options.map(opt => (
            <div 
              key={opt} 
              onClick={() => { onChange(opt); setIsOpen(false); }}
              className={`px-4 py-2 text-sm cursor-pointer transition-colors ${value === opt ? 'bg-black/5 dark:bg-white/10 text-[#1C1C1E] dark:text-white font-medium' : 'text-[#3A3631] dark:text-gray-300 hover:bg-black/5 dark:hover:bg-white/5'}`}
            >
              {opt}
            </div>
          ))}
        </div>
      )}
    </div>
  );
};

const PROVIDER_OPTIONS = {
  "Google": ["Gemini 2.5 Flash-Lite", "Gemini 3.1 Flash-Lite", "Gemini 3.5 Flash", "Gemini 3.5 Flash-Lite"],
  "OpenAI": ["GPT-5.5", "GPT-5.4", "GPT-5.4-mini", "GPT-4.1"],
  "Anthropic": ["Claude Opus 4.8", "Claude Opus 4.7", "Claude Sonnet 4.6", "Claude Haiku 4.5"],
  "xAI": ["Grok 4.5", "Grok 4.3", "Grok 4.1 Fast"],
  "DeepSeek": ["DeepSeek V4-Pro", "DeepSeek V4-Flash", "DeepSeek-V3.2"],
  "Mistral": ["Mistral Large 3", "Mistral Medium 3.5", "Mistral Small 4", "Devstral 2"],
  "Cohere": ["Command A", "Command R+", "Command R"],
  "Meta": ["Llama 4 Maverick", "Llama 4 Scout"]
};

function App() {
  const [uiState, setUiState] = useState<UIState>("idle");
  const [activeTab, setActiveTab] = useState<TabState>("assistant");
  const [duration, setDuration] = useState(0);
  const [historyLog, setHistoryLog] = useState<{title: string, desc: string, time: string}[]>([]);
  const [stats, setStats] = useState({ totalWords: "0", timeSaved: "0m", dictationCount: 0 });
  const [apiKeys, setApiKeys] = useState<Record<string, string>>({});
  const [models, setModels] = useState<Record<string, string>>({});
  const [isSavingKey, setIsSavingKey] = useState(false);
  const [activeKeyName, setActiveKeyName] = useState<string>("gemini");
  const [memoryData, setMemoryData] = useState<any>({ preferences: {}, projects: {}, active_tasks: {} });
  const [sysStats, setSysStats] = useState({ cpu: 0, ram: 0, battery: 100, plugged: true });
  const [processingMode, setProcessingMode] = useState<string>("Grammar Correction");
  const [globalHotkey, setGlobalHotkey] = useState<string>("Alt+X");
  const [showDock, setShowDock] = useState<boolean>(() => {
    const val = localStorage.getItem('show_dock');
    return val !== null ? val === 'true' : true;
  });
  const [newProvider, setNewProvider] = useState("Google");
  const [newKeyValue, setNewKeyValue] = useState("");
  const [newModel, setNewModel] = useState(PROVIDER_OPTIONS["Google"][0]);
  const [isModeDropdownOpen, setIsModeDropdownOpen] = useState(false);
  const [isAppFullscreen, setIsAppFullscreen] = useState(false);
  const [savedBounds, setSavedBounds] = useState<{width: number, height: number, x: number, y: number} | null>(null);
  const [chatResult, setChatResult] = useState<string>("");
  const [isSetupMode, setIsSetupMode] = useState(() => localStorage.getItem("setup_complete") !== "true");
  const [setupStep, setSetupStep] = useState(1);
  const [setupHotkeyTested, setSetupHotkeyTested] = useState(false);
  const [setupMicTested, setSetupMicTested] = useState(false);
  const [pillColor, setPillColor] = useState<string>(() => localStorage.getItem('pill_color') || 'black');
  const [notepads, setNotepads] = useState<Notepad[]>(() => {
    try {
      const saved = localStorage.getItem('lisa_notepads');
      if (saved) return JSON.parse(saved);
    } catch(e) {}
    return [];
  });
  const [activeNotepadId, setActiveNotepadId] = useState<number | null>(null);
  
  const activeTabRef = useRef<TabState>("assistant");
  const activeNotepadIdRef = useRef<number | null>(null);
  
  const updateNotepad = (id: number, updates: Partial<Notepad>) => {
      setNotepads(prev => prev.map(n => n.id === id ? { ...n, ...updates } : n));
  };
  const removeNotepad = (id: number) => {
      setNotepads(prev => prev.filter(n => n.id !== id));
      if (activeNotepadId === id) setActiveNotepadId(null);
  };
  
  useEffect(() => {
    activeTabRef.current = activeTab;
  }, [activeTab]);
  
  useEffect(() => {
    activeNotepadIdRef.current = activeNotepadId;
  }, [activeNotepadId]);
  
  useEffect(() => {
      const unlistenHotkeyPressed = listen('hotkey_pressed', () => {
        setSetupHotkeyTested(true);
      });

      const unlistenHotkeyReleased = listen("hotkey_released", () => {
        // Toggle logic handles this
      });

      const unlistenTextPolish = listen("trigger_text_polish", () => {
        if (ws.current && ws.current.readyState === WebSocket.OPEN) {
          ws.current.send(JSON.stringify({ type: "text_polish" }));
          setUiState("processing");
        }
      });

      return () => {
        unlistenHotkeyPressed.then(f => f());
        unlistenHotkeyReleased.then(f => f());
        unlistenTextPolish.then(f => f());
      };
  }, [uiState, processingMode]);
  
  useEffect(() => {
    localStorage.setItem('lisa_notepads', JSON.stringify(notepads));
  }, [notepads]);
  
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
                setModels(data.models || {});
                setActiveKeyName(data.active_key_name || "gemini");
                setProcessingMode(data.processing_mode || "Grammar Correction");
                const hk = data.global_hotkey || "Alt+X";
                setGlobalHotkey(hk);
                invoke('set_global_hotkey', { oldShortcut: null, newShortcut: hk }).catch(console.error);
                if (data.theme === "dark") document.body.classList.add("dark");
             }).catch(e => console.error(e));
             
           refreshData();
        }, 3000);
      } catch (err) {
        console.error('Failed to spawn sidecar:', err);
      }
    };
    launchSidecar();

    // Track if Dashboard is focused so the global hotkey knows whether to type or send to chat
    let unlistenFocus: any;
    getCurrentWindow().onFocusChanged(({ payload: focused }) => {
        localStorage.setItem('isDashboardFocused', focused ? 'true' : 'false');
    }).then(u => unlistenFocus = u);

    return () => {
        if (unlistenFocus) unlistenFocus();
    };
  }, []);
  
  const refreshData = async () => {
      try {
          const histRes = await fetch("http://127.0.0.1:8000/api/history");
          const histData = await histRes.json();
          setHistoryLog(histData);
          
          const statsRes = await fetch("http://127.0.0.1:8000/api/stats");
          const statsData = await statsRes.json();
          setStats(statsData);
          
          const memoryRes = await fetch("http://127.0.0.1:8000/api/memory");
          if (memoryRes.ok) {
              const memData = await memoryRes.json();
              setMemoryData(memData);
          }
      } catch(e) { console.error("Data refresh failed", e) }
  };

  // Theme Toggler
  // Apply initial showDock state
  useEffect(() => {
    invoke('toggle_dock', { show: showDock }).catch(console.error);
  }, []);

  useEffect(() => {
    refreshData();
    const handleContextMenu = (e: MouseEvent) => {
      e.preventDefault();
      document.body.classList.toggle("dark");
    };
    document.addEventListener("contextmenu", handleContextMenu);
    return () => document.removeEventListener("contextmenu", handleContextMenu);
  }, []);

  // Audio cues for state changes
  useEffect(() => {
    if (uiState === 'listening') {
      playChime();
    } else if (uiState === 'error') {
      playAlarm();
    }
  }, [uiState]);

  const handleClearHistory = async () => {
      try {
          await fetch("http://127.0.0.1:8000/api/history", { method: 'DELETE' });
          refreshData();
      } catch(e) { console.error("Failed to clear history", e) }
  };

  const handleDeleteHistoryItem = async (timestamp: number) => {
      try {
          await fetch(`http://127.0.0.1:8000/api/history/${timestamp}`, { method: 'DELETE' });
          refreshData();
      } catch(e) { console.error("Failed to delete history item", e) }
  };
  
  const handleDeleteMemory = async (category: string, key: string) => {
      try {
          await fetch(`http://127.0.0.1:8000/api/memory/${category}/${encodeURIComponent(key)}`, { method: 'DELETE' });
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
  
  const handleSaveSettings = async (overrides?: any) => {
      setIsSavingKey(true);
      try {
          const newHK = overrides?.globalHotkey || globalHotkey;
          if (overrides?.globalHotkey) {
              await invoke('set_global_hotkey', { oldShortcut: globalHotkey, newShortcut: newHK }).catch(console.error);
          }
          await fetch("http://127.0.0.1:8000/api/settings", {
              method: "POST",
              headers: { "Content-Type": "application/json" },
              body: JSON.stringify({
                  api_keys: overrides?.apiKeys || apiKeys,
                  models: overrides?.models || models,
                  active_key_name: overrides?.activeKeyName || activeKeyName,
                  theme: document.body.classList.contains("dark") ? "dark" : "light",
                  processing_mode: overrides?.processingMode || processingMode,
                  global_hotkey: newHK
              })
          });
      } catch(e) {}
      setIsSavingKey(false);
  };

  const handleModeChange = (mode: string) => {
      setProcessingMode(mode);
      handleSaveSettings({ processingMode: mode });
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
      if (!newProvider || !newModel || !newKeyValue) return;
      
      let profileName = `${newProvider} - ${newModel}`;
      let counter = 1;
      while (apiKeys[profileName]) {
          profileName = `${newProvider} - ${newModel} (${counter})`;
          counter++;
      }
      
      const updatedKeys = { ...apiKeys, [profileName]: newKeyValue };
      const updatedModels = { ...models, [profileName]: newModel };
      
      setApiKeys(updatedKeys);
      setModels(updatedModels);
      setNewKeyValue("");
      handleSaveSettings({ apiKeys: updatedKeys, models: updatedModels });
  };

  const handleSelectActiveKey = async (provider: string) => {
      if (window.confirm(`Are you sure you want to set "${provider}" as the active AI provider?`)) {
          setActiveKeyName(provider);
          handleSaveSettings({ activeKeyName: provider });
      }
  };

  const handleRemoveKey = async (provider: string) => {
      const updatedKeys = { ...apiKeys };
      delete updatedKeys[provider];
      
      const updatedModels = { ...models };
      if (updatedModels[provider]) delete updatedModels[provider];
      
      setApiKeys(updatedKeys);
      setModels(updatedModels);
      
      const newActive = activeKeyName === provider ? "gemini" : activeKeyName;
      setActiveKeyName(newActive);
      handleSaveSettings({ apiKeys: updatedKeys, models: updatedModels, activeKeyName: newActive });
  };

  const handlePillColorChange = async (color: string) => {
      setPillColor(color);
      localStorage.setItem('pill_color', color);
      try {
         const { emit } = await import('@tauri-apps/api/event');
         await emit('pill_color_changed', color);
      } catch(e) {}
  };

  // WebSocket
  useEffect(() => {
    ws.current = new WebSocket("ws://127.0.0.1:8000/ws/lisa");
    
    ws.current.onmessage = (event) => {
        try {
            const data = JSON.parse(event.data);
            if (data.type === "system_stats") {
                setSysStats({ cpu: data.cpu, ram: data.ram, battery: data.battery, plugged: data.plugged });
            } else if (data.type === "stats_updated") {
                refreshData();
            } else if (data.type === "message" && data.content.startsWith("Typed:")) {
                setUiState("idle");
                playSnap();
                // Refresh data from backend to get updated stats and history
                setTimeout(refreshData, 500);
            } else if (data.type === "message") {
                if (data.content === "Polishing..." || data.content === "Polishing text...") {
                    setUiState("processing");
                }
            } else if (data.type === "chat_result") {
                setUiState("idle");
                if (data.source === "notepad" || activeNotepadIdRef.current !== null) {
                    const targetId = activeNotepadIdRef.current;
                    if (targetId !== null) {
                        setNotepads(prev => prev.map(n => 
                            n.id === targetId 
                                ? { ...n, content: n.content ? n.content + "\n" + data.content : data.content } 
                                : n
                        ));
                    } else {
                        setChatResult(data.content);
                    }
                } else {
                    setChatResult(data.content);
                }
                setTimeout(refreshData, 500);
            } else if (data.type === "start_mic") {
                setUiState("listening");
                residualRef.current = "";
                transcriptRef.current = "";
            } else if (data.type === "stop_mic") {
                mainRec.current?.stop();
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
            ws.current.send(JSON.stringify({ text: finalStr, source: activeTabRef.current === 'notepad' ? 'notepad' : 'dashboard' }));
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
      
      <div className={`flex h-full w-full relative bg-[#F4EFE6] dark:bg-[#151413] text-[#1C1C1E] dark:text-white font-body-md overflow-hidden shadow-[0_20px_60px_rgba(0,0,0,0.15)] border border-[#EAE5D9] dark:border-[#3A3631] ${isAppFullscreen ? 'rounded-none border-none' : 'rounded-[24px]'}`}>
        
        {/* Setup Overlay */}
        {isSetupMode && (
          <div className="absolute inset-0 bg-[#F4EFE6]/95 dark:bg-[#151413]/95 backdrop-blur-md z-[100] flex flex-col items-center justify-center p-8 text-center" data-tauri-drag-region>
              <div className="max-w-md w-full bg-[#FDFBF7] dark:bg-[#201E1B] p-8 rounded-[24px] border border-[#D5D0C5] dark:border-[#3A3631] shadow-2xl relative z-10">
                  <img src="/logo.png" className="w-16 h-16 object-contain dark:invert mx-auto mb-6" alt="Logo" />
                  <h2 className="font-display text-2xl font-bold text-[#1C1C1E] dark:text-white mb-2">Welcome to Lisa Flow</h2>
                  
                  {setupStep === 1 && (
                      <div className="flex flex-col animate-in fade-in zoom-in duration-300">
                          <p className="text-[#8E8E93] dark:text-gray-400 mb-6 text-sm">Lisa needs microphone access to hear your dictation.</p>
                          <button 
                              onClick={() => {
                                  navigator.mediaDevices.getUserMedia({ audio: true })
                                      .then(stream => {
                                          stream.getTracks().forEach(t => t.stop());
                                          setSetupMicTested(true);
                                          setTimeout(() => setSetupStep(2), 500);
                                      })
                                      .catch(() => alert("Microphone access denied. Please allow it in OS settings."));
                              }}
                              className={`w-full py-3 rounded-xl font-semibold transition-colors flex items-center justify-center gap-2 ${setupMicTested ? 'bg-emerald-500 text-white' : 'bg-black dark:bg-white text-white dark:text-black'}`}
                          >
                              {setupMicTested ? <><span className="material-symbols-outlined text-[18px]">check_circle</span> Granted</> : "Grant Microphone Access"}
                          </button>
                      </div>
                  )}
  
                  {setupStep === 2 && (
                      <div className="flex flex-col animate-in fade-in slide-in-from-right duration-300">
                          <p className="text-[#8E8E93] dark:text-gray-400 mb-6 text-sm">Press <kbd className="bg-black/5 dark:bg-white/10 px-2 py-1 rounded">Alt + X</kbd> right now to test the global shortcut.</p>
                          <div className={`w-24 h-24 mx-auto rounded-full border-4 flex items-center justify-center transition-colors duration-300 ${setupHotkeyTested ? 'border-emerald-500 text-emerald-500 bg-emerald-500/10' : 'border-[#EAE5D9] dark:border-[#3A3631] text-[#8E8E93] dark:text-gray-400'}`}>
                              <span className="material-symbols-outlined text-4xl">{setupHotkeyTested ? 'check' : 'keyboard'}</span>
                          </div>
                          {setupHotkeyTested && (
                              <button 
                                  onClick={async () => {
                                      localStorage.setItem("setup_complete", "true");
                                      setIsSetupMode(false);
                                      const { emit } = await import('@tauri-apps/api/event');
                                      await emit('setup_finished');
                                      invoke('hide_dashboard').catch(()=>{}); // automatically hide dashboard after setup so they can see the pill
                                  }}
                                  className="w-full bg-black dark:bg-white text-white dark:text-black font-semibold py-3 rounded-xl mt-6 animate-in fade-in zoom-in transition-colors"
                              >
                                  Finish Setup
                              </button>
                          )}
                      </div>
                  )}
              </div>
          </div>
        )}
        
        {/* Background Ambient Effects (Removed for clean white theme) */}
  
        {/* SideNavBar */}
        <nav className="hidden md:flex w-64 h-full border-r border-[#EAE5D9] dark:border-[#3A3631] bg-[#F5F2EB] dark:bg-[#201E1B]/50 flex-col py-6 px-6 gap-y-6 z-10 shrink-0">
          
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
            <p className="font-label-sm text-label-sm text-black/50 dark:text-white/50">Smart Dictation Assistant</p>
          </div>
        
        <ul className="flex flex-col gap-2 flex-grow">
          <li>
            <a onClick={() => setActiveTab('assistant')} className={`flex items-center gap-3 px-4 py-3 rounded-full transition-all duration-300 cursor-pointer border ${activeTab === 'assistant' ? 'bg-gradient-to-r from-black/80 to-black/60 dark:from-white/10 dark:to-white/5 backdrop-blur-xl border-white/20 dark:border-[#3A3631] shadow-[0_8px_24px_rgba(0,0,0,0.15)] dark:shadow-[0_8px_24px_rgba(255,255,255,0.05)] text-white font-bold scale-95' : 'border-transparent text-black/60 dark:text-white/60 hover:bg-black/5 dark:hover:bg-white/10 hover:backdrop-blur-md hover:text-black dark:hover:text-white'}`}>
              <span className="material-symbols-outlined" style={{fontVariationSettings: "'FILL' 1"}}>mic</span>
              <span className="font-label-sm text-label-sm">Assistant</span>
            </a>
          </li>
          <li>
            <a onClick={() => setActiveTab('history')} className={`flex items-center gap-3 px-4 py-3 rounded-full transition-all duration-300 cursor-pointer border ${activeTab === 'history' ? 'bg-gradient-to-r from-black/80 to-black/60 dark:from-white/10 dark:to-white/5 backdrop-blur-xl border-white/20 dark:border-[#3A3631] shadow-[0_8px_24px_rgba(0,0,0,0.15)] dark:shadow-[0_8px_24px_rgba(255,255,255,0.05)] text-white font-bold scale-95' : 'border-transparent text-black/60 dark:text-white/60 hover:bg-black/5 dark:hover:bg-white/10 hover:backdrop-blur-md hover:text-black dark:hover:text-white'}`}>
              <span className="material-symbols-outlined">history</span>
              <span className="font-label-sm text-label-sm">History</span>
            </a>
          </li>
          <li>
            <a onClick={() => setActiveTab('settings')} className={`flex items-center gap-3 px-4 py-3 rounded-full transition-all duration-300 cursor-pointer border ${activeTab === 'settings' ? 'bg-gradient-to-r from-black/80 to-black/60 dark:from-white/10 dark:to-white/5 backdrop-blur-xl border-white/20 dark:border-[#3A3631] shadow-[0_8px_24px_rgba(0,0,0,0.15)] dark:shadow-[0_8px_24px_rgba(255,255,255,0.05)] text-white font-bold scale-95' : 'border-transparent text-black/60 dark:text-white/60 hover:bg-black/5 dark:hover:bg-white/10 hover:backdrop-blur-md hover:text-black dark:hover:text-white'}`}>
              <span className="material-symbols-outlined text-[20px]">settings</span>
              <span className="text-[14px] tracking-wide">Settings</span>
            </a>
          </li>
          <li>
            <a onClick={() => setActiveTab('memory')} className={`flex items-center gap-3 px-4 py-3 rounded-full transition-all duration-300 cursor-pointer border ${activeTab === 'memory' ? 'bg-gradient-to-r from-black/80 to-black/60 dark:from-white/10 dark:to-white/5 backdrop-blur-xl border-white/20 dark:border-[#3A3631] shadow-[0_8px_24px_rgba(0,0,0,0.15)] dark:shadow-[0_8px_24px_rgba(255,255,255,0.05)] text-white font-bold scale-95' : 'border-transparent text-black/60 dark:text-white/60 hover:bg-black/5 dark:hover:bg-white/10 hover:backdrop-blur-md hover:text-black dark:hover:text-white'}`}>
              <span className="material-symbols-outlined text-[20px]">psychology</span>
              <span className="text-[14px] tracking-wide">Memory</span>
            </a>
          </li>
        </ul>
      </nav>

      {/* Main Content Area */}
      <main className="flex-1 flex flex-col h-full overflow-hidden relative z-10 bg-[#FDFBF7] dark:bg-[#151413]">
        <header className="flex flex-col px-8 w-full max-w-[1440px] mx-auto shrink-0 mt-8 md:mt-12 md:px-margin pb-4" data-tauri-drag-region>
          <div className="md:hidden mb-4">
            <div className="flex items-center gap-2">
              <img src="/logo.png" className="w-6 h-6 object-contain dark:invert" alt="Lisa Flow Logo" />
              <h1 className="font-display text-headline-md text-[#1C1C1E] dark:text-white font-bold">Lisa Flow</h1>
            </div>
          </div>
          
          <div className="hidden md:flex flex-col w-full pointer-events-none">
            <h2 className="font-display text-display text-[#1C1C1E] dark:text-white tracking-tight font-medium whitespace-nowrap">Welcome to Lisa Flow</h2>
            
            <div className="flex items-center justify-between w-full mt-3 pointer-events-auto">
              <div className="flex items-center gap-2 pointer-events-none">
                <div className={`w-2 h-2 rounded-full ${uiState === 'idle' ? 'bg-emerald-500' : 'dark:bg-white bg-black dark:text-black text-white'} animate-pulse`}></div>
                <span className="font-label-sm text-label-sm text-[#8E8E93] dark:text-gray-400 font-medium">System Status: {uiState}</span>
              </div>
              
              <div className="flex items-center gap-4">
                {/* System Command Center Stats */}
                <div className="hidden md:flex items-center gap-2 pointer-events-none">
                   <div className="flex items-center gap-1.5 bg-[#EAE5D9]/30 dark:bg-[#201E1B] px-3 py-1.5 rounded-full border border-[#EAE5D9] dark:border-[#3A3631]">
                      <span className="material-symbols-outlined text-[14px] text-[#8E8E93] dark:text-gray-400">memory</span>
                      <span className="text-xs font-medium text-[#8E8E93] dark:text-gray-400">{sysStats.ram.toFixed(0)}%</span>
                   </div>
                   <div className="flex items-center gap-1.5 bg-[#EAE5D9]/30 dark:bg-[#201E1B] px-3 py-1.5 rounded-full border border-[#EAE5D9] dark:border-[#3A3631]">
                      <span className="material-symbols-outlined text-[14px] text-[#8E8E93] dark:text-gray-400">speed</span>
                      <span className="text-xs font-medium text-[#8E8E93] dark:text-gray-400">{sysStats.cpu.toFixed(0)}%</span>
                   </div>
                   <div className="flex items-center gap-1.5 bg-[#EAE5D9]/30 dark:bg-[#201E1B] px-3 py-1.5 rounded-full border border-[#EAE5D9] dark:border-[#3A3631]">
                      <span className="material-symbols-outlined text-[14px] text-[#8E8E93] dark:text-gray-400">
                         {sysStats.plugged ? 'battery_charging_full' : sysStats.battery > 20 ? 'battery_full' : 'battery_alert'}
                      </span>
                      <span className="text-xs font-medium text-[#8E8E93] dark:text-gray-400">{sysStats.battery.toFixed(0)}%</span>
                   </div>
                </div>
                
                {/* Spawn Notepad Button */}
                <button onClick={() => {
                    const newId = Date.now();
                    setNotepads(prev => {
                        const minimized = prev.map(n => ({ ...n, state: 'minimized' as NotepadState }));
                        return [...minimized, { id: newId, content: "", state: "normal" as NotepadState }];
                    });
                    setActiveNotepadId(newId);
                    setActiveTab('notepad');
                }} className="w-10 h-10 rounded-full bg-[#F5F2EB] dark:bg-[#201E1B] border border-[#EAE5D9] dark:border-[#3A3631] flex items-center justify-center hover:bg-black/5 dark:hover:bg-white/10 transition-colors group">
                  <span className="material-symbols-outlined text-[#1C1C1E] dark:text-white group-hover:rotate-90 transition-transform">add</span>
                </button>
              </div>
            </div>
          </div>
        </header>

        {/* Scrollable Content */}
        <div className="flex-1 overflow-y-auto px-4 md:px-margin pb-12 w-full max-w-[1440px] mx-auto">
          {activeTab === 'assistant' && (
            <div className="grid grid-cols-1 lg:grid-cols-12 gap-gutter mt-8">
              <div className="lg:col-span-8 flex flex-col gap-gutter">
                {/* Primary Action Card */}
                <div onClick={toggleMic} className={`relative overflow-hidden rounded-[24px] bg-[#F5F2EB] dark:bg-[#201E1B] border ${uiState === 'listening' ? 'dark:border-white border-black' : 'border-[#EAE5D9] dark:border-[#3A3631]'} p-10 flex flex-col items-center justify-center min-h-[320px] group cursor-pointer transition-transform duration-500 hover:scale-[1.01]`}>
                  <div className="absolute inset-0 bg-gradient-to-br from-primary/5 to-transparent opacity-0 group-hover:opacity-100 transition-opacity duration-500"></div>
                  
                  {uiState === 'idle' && (
                    <>
                      <div className="relative z-10 w-24 h-24 rounded-full bg-[#FDFBF7] dark:bg-[#151413] flex items-center justify-center shadow-[0_8px_30px_rgba(0,0,0,0.08)] mb-6 group-hover:scale-110 transition-transform duration-500 ease-out border border-[#EAE5D9] dark:border-[#3A3631]">
                        <img src="/logo.png" className="w-8 h-8 opacity-60 dark:invert" alt="Logo" />
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

                {/* Chat Result Box */}
                {chatResult && (
                  <div className="bg-[#F5F2EB] dark:bg-[#201E1B] border border-[#EAE5D9] dark:border-[#3A3631] rounded-[20px] p-6 relative">
                    <div className="flex justify-between items-start mb-2">
                      <h4 className="font-label-sm text-[12px] text-[#8E8E93] dark:text-gray-400 uppercase tracking-wider font-semibold">Processed Text</h4>
                      <button 
                        onClick={() => {
                          navigator.clipboard.writeText(chatResult);
                          // Provide brief visual feedback (optional)
                          const btn = document.getElementById('copy-btn');
                          if (btn) {
                            btn.innerText = "done";
                            setTimeout(() => btn.innerText = "content_copy", 2000);
                          }
                        }}
                        className="text-[#8E8E93] dark:text-gray-400 hover:text-black dark:hover:text-white transition-colors flex items-center justify-center p-1"
                        title="Copy to clipboard"
                      >
                        <span id="copy-btn" className="material-symbols-outlined text-sm">content_copy</span>
                      </button>
                    </div>
                    <p className="font-body-md text-[#1C1C1E] dark:text-white whitespace-pre-wrap">{chatResult}</p>
                  </div>
                )}

                {/* Statistics Grid */}
                <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
                  <div className="bg-[#F5F2EB] dark:bg-[#201E1B] border border-[#EAE5D9] dark:border-[#3A3631] rounded-[20px] p-6 flex flex-col gap-2 relative overflow-hidden">
                    <span className="material-symbols-outlined text-[#8E8E93] dark:text-gray-400 text-sm">text_snippet</span>
                    <span className="font-display text-headline-lg text-[#1C1C1E] dark:text-white font-bold tracking-tight">{stats.totalWords}</span>
                    <span className="font-label-sm text-[12px] text-[#8E8E93] dark:text-gray-400 uppercase tracking-wider font-semibold">Total Words</span>
                  </div>
                  <div className="bg-[#F5F2EB] dark:bg-[#201E1B] border border-[#EAE5D9] dark:border-[#3A3631] rounded-[20px] p-6 flex flex-col gap-2 relative overflow-hidden">
                    <span className="material-symbols-outlined text-[#8E8E93] dark:text-gray-400 text-sm">history_edu</span>
                    <span className="font-display text-headline-lg text-[#1C1C1E] dark:text-white font-bold tracking-tight">{stats.dictationCount}</span>
                    <span className="font-label-sm text-[12px] text-[#8E8E93] dark:text-gray-400 uppercase tracking-wider font-semibold">Dictations</span>
                  </div>
                  <div className="bg-[#F5F2EB] dark:bg-[#201E1B] border border-[#EAE5D9] dark:border-[#3A3631] rounded-[20px] p-6 flex flex-col gap-2 relative overflow-hidden">
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
                    <div key={i} className="group bg-[#F5F2EB] dark:bg-[#201E1B] border border-[#EAE5D9] dark:border-[#3A3631] hover:border-[#D1D1D6] dark:border-white/20 transition-all duration-300 rounded-[20px] p-4 cursor-pointer">
                      <div className="flex items-start justify-between gap-4">
                        <div className="w-10 h-10 rounded-full bg-[#FDFBF7] dark:bg-[#151413] border border-[#EAE5D9] dark:border-[#3A3631] flex items-center justify-center shrink-0 group-hover:dark:border-white border-black/30 transition-colors">
                          <span className="material-symbols-outlined text-[20px] text-[#8E8E93] group-hover:text-black dark:group-hover:text-white transition-colors">description</span>
                        </div>
                        <div className="flex-1 min-w-0">
                          <h4 className="font-label-sm text-label-sm font-semibold text-[#1C1C1E] dark:text-white truncate mb-1">{log.title}</h4>
                          <p className="font-body-md text-[13px] leading-tight text-[#3A3A3C] dark:text-gray-500 line-clamp-2">{log.desc}</p>
                        </div>
                        <div className="flex flex-col items-end gap-2 shrink-0">
                            <span className="font-label-sm text-[11px] text-[#8E8E93] dark:text-gray-400 font-medium">{log.time}</span>
                            <button 
                                onClick={(e) => {
                                    e.stopPropagation();
                                    navigator.clipboard.writeText(log.desc);
                                    const btn = e.currentTarget.querySelector('span');
                                    if (btn) {
                                        btn.innerText = "done";
                                        setTimeout(() => btn.innerText = "content_copy", 2000);
                                    }
                                }}
                                className="text-[#8E8E93] dark:text-gray-400 hover:text-black dark:hover:text-white transition-colors"
                                title="Copy to clipboard"
                            >
                                <span className="material-symbols-outlined text-[14px]">content_copy</span>
                            </button>
                        </div>
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

          {activeTab === 'notepad' && (
             <div className="flex flex-col h-[calc(100vh-140px)] mt-4 gap-4">
                {/* Minimized Dock */}
                {notepads.filter(n => n.state === 'minimized').length > 0 && (
                  <div className="flex gap-3 flex-wrap">
                     {notepads.filter(n => n.state === 'minimized').map(notepad => (
                         <div key={notepad.id} onClick={() => {
                             setActiveNotepadId(notepad.id);
                             setNotepads(prev => prev.map(n => n.id === notepad.id ? { ...n, state: 'normal' } : { ...n, state: 'minimized' }));
                         }} className={`pointer-events-auto w-[220px] shrink-0 flex flex-col rounded-full transition-all duration-300 cursor-pointer overflow-hidden shadow-sm border border-[#EAE5D9] dark:border-[#3A3631] ${activeNotepadId === notepad.id ? 'ring-2 ring-primary scale-[1.02]' : 'hover:scale-[1.02] opacity-80 hover:opacity-100'}`}>
                           <NotepadView notepad={notepad} updateNotepad={updateNotepad} uiState={uiState} isActive={activeNotepadId === notepad.id} setActive={() => {}} remove={() => removeNotepad(notepad.id)} />
                         </div>
                     ))}
                  </div>
                )}
                
                {/* Tab Notepad View (Normal) */}
                {notepads.some(n => n.state === 'normal') ? (
                  <div className="flex-1 w-full rounded-[24px] overflow-hidden shadow-lg border border-[#EAE5D9] dark:border-[#3A3631] relative">
                     <NotepadView 
                         notepad={notepads.find(n => n.state === 'normal')!} 
                         updateNotepad={updateNotepad} 
                         uiState={uiState} 
                         isActive={activeNotepadId === notepads.find(n => n.state === 'normal')!.id} 
                         setActive={() => setActiveNotepadId(notepads.find(n => n.state === 'normal')!.id)} 
                         remove={() => removeNotepad(notepads.find(n => n.state === 'normal')!.id)} 
                     />
                  </div>
                ) : !notepads.some(n => n.state === 'maximized') && (
                  <div className="flex-1 w-full rounded-[24px] flex flex-col items-center justify-center text-[#8E8E93] dark:text-gray-400 border border-dashed border-[#EAE5D9] dark:border-[#3A3631]">
                     <span className="material-symbols-outlined text-4xl mb-2 opacity-50">note_stack</span>
                     <p className="font-label-sm">No scratchpad is actively open.</p>
                     <p className="text-xs mt-1">Click a minimized notepad above, or click + to create a new one.</p>
                  </div>
                )}
             </div>
          )}

          {activeTab === 'settings' && (
             <div className="mt-8 space-y-6">
                <h3 className="font-display text-headline-lg text-[#1C1C1E] dark:text-white mb-4">Settings</h3>
                
                {/* General Settings */}
                <div className="bg-[#F5F2EB] dark:bg-[#201E1B] border border-[#EAE5D9] dark:border-[#3A3631] rounded-[20px] p-6">
                   <h4 className="font-headline-md text-[#1C1C1E] dark:text-white mb-2 font-semibold">General Settings</h4>
                   <p className="text-sm text-[#8E8E93] dark:text-gray-400 mb-4">Customize the AI processing mode and writing style.</p>
                   
                   <div className="flex flex-col gap-2">
                     <label className="text-sm font-semibold text-[#1C1C1E] dark:text-white">Processing Mode</label>
                     <div className="relative">
                       <button 
                         onClick={() => setIsModeDropdownOpen(!isModeDropdownOpen)}
                         className="w-full flex items-center justify-between px-4 py-3 rounded-xl bg-[#FDFBF7] dark:bg-[#272421] border border-[#EAE5D9] dark:border-[#3A3631] text-[#1C1C1E] dark:text-white text-sm font-medium transition-all hover:border-black/20 dark:hover:border-white/30"
                       >
                         <span>{processingMode}</span>
                         <span className={`material-symbols-outlined text-[18px] transition-transform duration-300 ${isModeDropdownOpen ? 'rotate-180' : ''}`}>expand_more</span>
                       </button>
                       
                       {isModeDropdownOpen && (
                         <>
                           <div className="fixed inset-0 z-10" onClick={() => setIsModeDropdownOpen(false)}></div>
                           <div className="absolute top-full left-0 w-full mt-2 bg-[#FDFBF7] dark:bg-[#272421] border border-[#EAE5D9] dark:border-[#3A3631] rounded-xl shadow-[0_10px_30px_rgba(0,0,0,0.05)] dark:shadow-[0_10px_30px_rgba(0,0,0,0.4)] z-20 overflow-hidden py-1 transform origin-top animate-in fade-in slide-in-from-top-2 duration-200">
                             {['Grammar Correction', 'Prompt Writing', 'Formal / Academic', 'Casual'].map(mode => (
                               <button
                                 key={mode}
                                 onClick={() => handleModeChange(mode)}
                                 className="w-full text-left px-4 py-2.5 text-sm text-[#1C1C1E] dark:text-white hover:bg-[#F5F2EB] dark:hover:bg-white/5 transition-colors flex items-center justify-between"
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

                 {/* Appearance & Dock */}
                 <div className="bg-[#F5F2EB] dark:bg-[#201E1B] border border-[#EAE5D9] dark:border-[#3A3631] rounded-[20px] p-6 mt-6">
                   <h4 className="font-headline-md text-[#1C1C1E] dark:text-white mb-2 font-semibold">Floating Dock</h4>
                   <p className="text-sm text-[#8E8E93] dark:text-gray-400 mb-4">Show or hide the minimal floating indicator.</p>
                   
                   <label className="flex items-center justify-between cursor-pointer group">
                      <span className="text-[15px] font-medium text-[#1C1C1E] dark:text-white group-hover:text-black dark:group-hover:text-white/80 transition-colors">Show Dock</span>
                      <div className="relative">
                          <input 
                              type="checkbox" 
                              className="sr-only" 
                              checked={showDock}
                              onChange={(e) => {
                                  const show = e.target.checked;
                                  setShowDock(show);
                                  localStorage.setItem('show_dock', show ? 'true' : 'false');
                                  invoke('toggle_dock', { show }).catch(console.error);
                              }}
                          />
                          <div className={`w-11 h-6 rounded-full transition-colors duration-300 ${showDock ? 'bg-[#34C759]' : 'bg-[#EAE5D9] dark:bg-[#322F2A]'}`}></div>
                          <div className={`absolute top-0.5 left-[2px] w-5 h-5 bg-white rounded-full shadow-sm transform transition-transform duration-300 ${showDock ? 'translate-x-[20px]' : 'translate-x-0'}`}></div>
                      </div>
                   </label>
                 </div>

                <div className="bg-[#F5F2EB] dark:bg-[#201E1B] border border-[#EAE5D9] dark:border-[#3A3631] rounded-[20px] p-6">
                   <h4 className="font-headline-md text-[#1C1C1E] dark:text-white mb-2 font-semibold">API Key Vault</h4>
                   <p className="text-sm text-[#8E8E93] dark:text-gray-400 mb-6">Securely manage API keys for various AI providers (Gemini, OpenAI, Anthropic).</p>
                   
                   {/* Key List */}
                   <div className="flex flex-col gap-3 mb-6">
                     {Object.entries(apiKeys).length === 0 ? (
                       <div className="text-sm text-[#8E8E93] dark:text-gray-400 italic">No keys configured yet.</div>
                     ) : (
                       Object.entries(apiKeys).map(([provider, val]) => (
                         <div key={provider} className={`flex items-center justify-between bg-[#FDFBF7] dark:bg-[#151413] border ${activeKeyName === provider ? 'border-[#1C1C1E] dark:border-[#F2F2F7]' : 'border-[#EAE5D9] dark:border-[#3A3631]'} p-3 rounded-xl transition-colors`}>
                           <div className="flex flex-col">
                             <span className="font-semibold text-sm text-[#1C1C1E] dark:text-white flex items-center gap-2">
                               {provider} 
                               {activeKeyName === provider && <span className="text-[10px] font-bold bg-[#1C1C1E] text-[#FDFBF7] dark:bg-[#F2F2F7] dark:text-[#151413] px-2 py-0.5 rounded-full uppercase tracking-wider">Active</span>}
                             </span>
                             <span className="font-mono text-[11px] text-[#8E8E93] dark:text-gray-400 mt-0.5">Key: ••••••••{val.slice(-4)} {models[provider] ? `| Model: ${models[provider]}` : ''}</span>
                           </div>
                           <div className="flex gap-2">
                             {activeKeyName !== provider && (
                               <button onClick={() => handleSelectActiveKey(provider)} className="px-3 py-1.5 rounded-lg text-[12px] font-semibold bg-[#F5F2EB] dark:bg-[#322F2A] hover:bg-black/10 dark:hover:bg-white/10 transition-colors">
                                 Select
                               </button>
                             )}
                             <button onClick={() => handleRemoveKey(provider)} className="w-8 h-8 rounded-lg hover:bg-error/10 text-[#8E8E93] dark:text-gray-400 hover:text-error flex items-center justify-center transition-colors">
                               <span className="material-symbols-outlined text-sm">delete</span>
                             </button>
                           </div>
                         </div>
                       ))
                     )}
                   </div>

                   {/* Add Key Form */}
                   <div className="flex flex-col gap-3 mt-2 border-t border-[#EAE5D9] dark:border-[#3A3631] pt-6">
                     <div className="flex gap-3 items-center relative z-20">
                       <Dropdown 
                         value={newProvider} 
                         options={Object.keys(PROVIDER_OPTIONS)}
                         onChange={val => { 
                           setNewProvider(val); 
                           setNewModel(PROVIDER_OPTIONS[val as keyof typeof PROVIDER_OPTIONS][0]); 
                         }} 
                         className="w-[28%]"
                       />
                       <Dropdown 
                         value={newModel} 
                         options={PROVIDER_OPTIONS[newProvider as keyof typeof PROVIDER_OPTIONS] || []}
                         onChange={val => setNewModel(val)} 
                         className="w-[35%]"
                       />
                       <input 
                         type="password" 
                         placeholder="Enter API Key" 
                         value={newKeyValue} 
                         onChange={e => setNewKeyValue(e.target.value)} 
                         className="flex-1 min-w-0 px-4 py-2.5 rounded-xl bg-[#FDFBF7] dark:bg-[#151413] border border-[#EAE5D9] dark:border-[#3A3631] text-[#1C1C1E] dark:text-white shadow-sm text-sm focus:outline-none focus:border-black focus:dark:border-white transition-colors" 
                       />
                     </div>
                     <button 
                       onClick={handleAddKey} 
                       disabled={isSavingKey || !newKeyValue} 
                       className="w-full dark:bg-white bg-black dark:text-black text-white px-5 py-2.5 rounded-xl text-sm font-semibold hover:dark:bg-white bg-black dark:text-black text-white/90 transition-colors shadow-sm disabled:opacity-50 relative z-10"
                     >
                        {isSavingKey ? "Saving..." : "Add Key Profile"}
                     </button>
                   </div>
                </div>
                
                {/* Global Hotkey */}
                <div className="bg-[#F5F2EB] dark:bg-[#201E1B] border border-[#EAE5D9] dark:border-[#3A3631] rounded-[20px] p-6 mt-6">
                   <h4 className="font-headline-md text-[#1C1C1E] dark:text-white mb-2 font-semibold">Global Shortcut</h4>
                   <p className="text-sm text-[#8E8E93] dark:text-gray-400 mb-4">Set the custom shortcut used to activate dictation from anywhere.</p>
                   <div className="flex gap-3 items-center">
                       <input
                           type="text"
                           readOnly
                           value={globalHotkey}
                           placeholder="Press keys..."
                           onKeyDown={(e) => {
                               e.preventDefault();
                               e.stopPropagation();
                               
                               const keys = [];
                               if (e.ctrlKey || e.metaKey) keys.push('CommandOrControl');
                               if (e.altKey) keys.push('Alt');
                               if (e.shiftKey) keys.push('Shift');
                               
                               // Ignore lone modifiers
                               if (['Control', 'Shift', 'Alt', 'Meta'].includes(e.key)) return;
                               
                               let mainKey = e.key.toUpperCase();
                               if (e.code === 'Space') mainKey = 'Space';
                               
                               keys.push(mainKey);
                               const newHK = keys.join('+');
                               setGlobalHotkey(newHK);
                               handleSaveSettings({ globalHotkey: newHK });
                           }}
                           className="flex-1 px-4 py-3 rounded-xl bg-[#FDFBF7] dark:bg-[#151413] border border-[#EAE5D9] dark:border-[#3A3631] focus:outline-none focus:dark:border-white focus:border-black text-[#1C1C1E] dark:text-white shadow-sm font-semibold text-center tracking-widest cursor-pointer transition-colors"
                       />
                       <button 
                           onClick={() => { setGlobalHotkey("Alt+X"); handleSaveSettings({ globalHotkey: "Alt+X" }); }}
                           className="px-4 py-3 rounded-xl text-sm font-semibold text-[#1C1C1E] dark:text-white bg-[#EAE5D9] dark:bg-[#322F2A] hover:bg-black/10 dark:hover:bg-white/10 transition-colors shrink-0"
                       >
                           Reset
                       </button>
                   </div>
                </div>

                <div className="bg-[#F5F2EB] dark:bg-[#201E1B] border border-[#EAE5D9] dark:border-[#3A3631] rounded-[20px] p-6 mt-6">
                   <h4 className="font-headline-md text-[#1C1C1E] dark:text-white mb-2 font-semibold">Theme</h4>
                   <p className="text-sm text-[#8E8E93] dark:text-gray-400 mb-4">Choose your preferred appearance.</p>
                   <div className="flex gap-4">
                     <div className="flex p-[4px] bg-[#E5E5EA]/80 dark:bg-white/5 rounded-full relative w-[184px] border border-black/5 dark:border-[#3A3631] shadow-inner backdrop-blur-md">
                         {/* Sliding Background Indicator */}
                         <div className="absolute top-[4px] bottom-[4px] left-[4px] w-[88px] bg-[#FDFBF7] dark:bg-[#322F2A] rounded-full shadow-[0_2px_8px_rgba(0,0,0,0.08)] transition-transform duration-500 ease-[cubic-bezier(0.16,1,0.3,1)] translate-x-0 dark:translate-x-[88px] border border-black/5 dark:border-[#3A3631]"></div>
                         
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

                {/* Pill Color Customization */}
                <div className="bg-[#F5F2EB] dark:bg-[#201E1B] border border-[#EAE5D9] dark:border-[#3A3631] rounded-[20px] p-6 mt-6">
                   <h4 className="font-headline-md text-[#1C1C1E] dark:text-white mb-2 font-semibold">Pill Color</h4>
                   <p className="text-sm text-[#8E8E93] dark:text-gray-400 mb-4">Customize the inactive pill's appearance.</p>
                   <div className="flex gap-3">
                       {['black', 'white', 'yellow', 'orange', 'purple', 'pink'].map(c => (
                           <button 
                               key={c}
                               onClick={() => handlePillColorChange(c)}
                               className={`w-8 h-8 rounded-full border-2 transition-transform hover:scale-110 shadow-sm`}
                               style={{
                                   backgroundColor: c === 'black' ? '#1C1C1E' : c === 'white' ? '#F2F2F7' : c === 'yellow' ? '#FFD60A' : c === 'orange' ? '#FF9F0A' : c === 'purple' ? '#BF5AF2' : '#FF375F',
                                   borderColor: pillColor === c ? '#007AFF' : 'transparent',
                                   outline: c === 'black' || c === 'white' ? '1px solid rgba(128,128,128,0.2)' : 'none'
                               }}
                           />
                       ))}
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
                        <div className="flex flex-col items-end gap-2 shrink-0">
                            <span className="font-label-sm text-[12px] text-[#8E8E93] dark:text-gray-400 font-medium">{log.time}</span>
                            <div className="flex items-center gap-2">
                                <button 
                                    onClick={(e) => {
                                        e.stopPropagation();
                                        navigator.clipboard.writeText(log.desc);
                                        const btn = e.currentTarget.querySelector('span');
                                        if (btn) {
                                            btn.innerText = "done";
                                            setTimeout(() => btn.innerText = "content_copy", 2000);
                                        }
                                    }}
                                    className="text-[#8E8E93] dark:text-gray-400 hover:text-black dark:hover:text-white transition-colors p-1"
                                    title="Copy to clipboard"
                                >
                                    <span className="material-symbols-outlined text-[16px]">content_copy</span>
                                </button>
                                {log.timestamp && (
                                    <button 
                                        onClick={(e) => {
                                            e.stopPropagation();
                                            handleDeleteHistoryItem(log.timestamp);
                                        }}
                                        className="text-[#8E8E93] dark:text-gray-400 hover:text-error dark:hover:text-error transition-colors p-1"
                                        title="Delete"
                                    >
                                        <span className="material-symbols-outlined text-[16px]">delete</span>
                                    </button>
                                )}
                            </div>
                        </div>
                      </div>
                    </div>
                  ))}
                  {historyLog.length === 0 && (
                     <div className="text-[#8E8E93] dark:text-gray-400 text-sm">No history available yet.</div>
                  )}
                </div>
             </div>
          )}

          {activeTab === 'memory' && (
            <div className="flex flex-col gap-6 w-full max-w-4xl mx-auto animate-in fade-in zoom-in-95 duration-300">
              <div className="flex justify-between items-end border-b border-[#EAE5D9] dark:border-[#3A3631] pb-4">
                <div>
                  <h2 className="text-3xl font-display font-bold text-[#1C1C1E] dark:text-white">Lisa's Memory</h2>
                  <p className="text-[#8E8E93] dark:text-gray-400 mt-1">Context Lisa has learned from your dictations in the background.</p>
                </div>
              </div>

              {['active_tasks', 'projects', 'preferences'].map((category) => {
                const categoryTitle = category === 'active_tasks' ? 'Active Tasks' : category === 'projects' ? 'Project Knowledge' : 'User Preferences';
                const entries = Object.entries(memoryData[category] || {});
                
                return (
                  <div key={category} className="bg-[#FDFBF7] dark:bg-[#151413] border border-[#EAE5D9] dark:border-[#3A3631] rounded-2xl p-6 shadow-sm">
                    <h3 className="font-semibold text-lg text-[#1C1C1E] dark:text-white mb-4">{categoryTitle}</h3>
                    {entries.length === 0 ? (
                      <p className="text-[#8E8E93] dark:text-gray-400 text-sm italic">Nothing learned here yet.</p>
                    ) : (
                      <div className="flex flex-col gap-3">
                        {entries.map(([key, data]: [string, any]) => (
                          <div key={key} className="flex justify-between items-start bg-[#F5F2EB] dark:bg-[#201E1B] border border-[#EAE5D9] dark:border-[#3A3631] p-3 rounded-xl transition-colors hover:shadow-sm">
                            <div className="flex flex-col">
                              <span className="font-semibold text-sm text-[#1C1C1E] dark:text-white">{key}</span>
                              <span className="text-sm text-[#8E8E93] dark:text-gray-300 mt-1">{data.description || data.context || data.value}</span>
                            </div>
                            <button onClick={() => handleDeleteMemory(category, key)} className="w-8 h-8 rounded-lg hover:bg-error/10 text-[#8E8E93] dark:text-gray-400 hover:text-error flex items-center justify-center transition-colors">
                              <span className="material-symbols-outlined text-sm">delete</span>
                            </button>
                          </div>
                        ))}
                      </div>
                    )}
                  </div>
                );
              })}
            </div>
          )}

        </div>
      </main>
      </div>

      {/* Fullscreen Maximized Notepads Overlay */}
      {notepads.filter(n => n.state === 'maximized').map(notepad => (
          <div key={notepad.id} className="fixed inset-0 z-[200] bg-black/40 backdrop-blur-sm p-4 md:p-12 flex flex-col pointer-events-auto">
             <div className="flex-1 w-full h-full rounded-[24px] overflow-hidden shadow-2xl border border-white/20">
                 <NotepadView 
                     notepad={notepad} 
                     updateNotepad={updateNotepad} 
                     uiState={uiState} 
                     isActive={activeNotepadId === notepad.id} 
                     setActive={() => setActiveNotepadId(notepad.id)} 
                     remove={() => removeNotepad(notepad.id)} 
                 />
             </div>
          </div>
      ))}
    </div>
  );
}

const NotepadView = ({ notepad, updateNotepad, uiState, isActive, setActive, remove }: { notepad: Notepad, updateNotepad: Function, uiState: string, isActive: boolean, setActive: () => void, remove: () => void }) => {
    return (
        <div className={`flex flex-col w-full h-full bg-[#F9F9F9] dark:bg-[#1C1C1E] transition-colors`} onClick={setActive}>
              <div className={`flex justify-between items-center px-4 py-3 bg-[#F2F2F7] dark:bg-[#111111] shrink-0 border-b border-[#E5E5EA] dark:border-white/10`}>
                <div className="flex items-center gap-2 group">
                   <button onClick={(e) => { e.stopPropagation(); remove(); }} className="w-3.5 h-3.5 rounded-full bg-[#ff5f56] border border-[#e0443e] cursor-pointer hover:bg-[#ff4b4b] transition-colors flex items-center justify-center" title="Close Notepad">
                     <span className="material-symbols-outlined text-[10px] text-[#4d0000] opacity-0 group-hover:opacity-100 transition-opacity font-extrabold leading-none">close</span>
                   </button>
                   <button onClick={(e) => { e.stopPropagation(); updateNotepad(notepad.id, { state: notepad.state === 'minimized' ? 'normal' : 'minimized' }); }} className="w-3.5 h-3.5 rounded-full bg-[#ffbd2e] border border-[#dea123] cursor-pointer hover:bg-[#ffb011] transition-colors flex items-center justify-center" title="Minimize Notepad">
                     <span className="material-symbols-outlined text-[10px] text-[#5c3e00] opacity-0 group-hover:opacity-100 transition-opacity font-extrabold leading-none">remove</span>
                   </button>
                   <button onClick={(e) => { e.stopPropagation(); updateNotepad(notepad.id, { state: notepad.state === 'maximized' ? 'normal' : 'maximized' }); }} className="w-3.5 h-3.5 rounded-full bg-[#27c93f] border border-[#1aab29] cursor-pointer hover:bg-[#20b836] transition-colors flex items-center justify-center" title="Maximize Notepad">
                     <span className="material-symbols-outlined text-[10px] text-[#004d00] opacity-0 group-hover:opacity-100 transition-opacity font-extrabold leading-none" style={{ transform: 'rotate(45deg)' }}>unfold_more</span>
                   </button>
                   <span className="ml-2 font-label-sm text-[11px] text-[#8E8E93] dark:text-gray-400 font-semibold uppercase tracking-wider truncate max-w-[80px]">Note {notepad.id.toString().slice(-4)}</span>
                </div>
                <div className="flex items-center gap-2">
                   {isActive && uiState === 'listening' && <span className="font-label-sm text-error animate-pulse text-[10px]">Listening...</span>}
                   {isActive && uiState === 'processing' && <span className="font-label-sm text-[#8E8E93] dark:text-gray-400 text-[10px]">Processing...</span>}
                   {notepad.state !== 'minimized' && <button onClick={(e) => { e.stopPropagation(); updateNotepad(notepad.id, { content: "" }); }} className="text-[10px] font-semibold text-[#8E8E93] hover:text-error transition-colors">Clear</button>}
                </div>
              </div>
              {notepad.state !== 'minimized' && (
                <textarea
                  value={notepad.content}
                  onChange={(e) => updateNotepad(notepad.id, { content: e.target.value })}
                  placeholder={isActive ? `Press ${globalHotkey || 'Alt+X'} to toggle dictation, or type here...` : "Click to activate this notepad..."}
                  className="flex-1 w-full bg-transparent p-4 text-[#1C1C1E] dark:text-white font-body-md text-[13px] resize-none focus:outline-none transition-colors"
                />
              )}
        </div>
    );
};

export default App;
