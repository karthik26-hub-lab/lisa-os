import { useEffect, useRef, useState } from 'react';
import * as PIXI from 'pixi.js';

// We must set window.PIXI BEFORE importing pixi-live2d-display
(window as any).PIXI = PIXI;

interface Live2DViewerProps {
  isSpeaking: boolean;
}

export default function Live2DViewer({ isSpeaking }: Live2DViewerProps) {
  const containerRef = useRef<HTMLDivElement>(null);
  const appRef = useRef<PIXI.Application | null>(null);
  const modelRef = useRef<any>(null);
  const tickerRef = useRef<PIXI.Ticker | null>(null);
  
  const [loadStatus, setLoadStatus] = useState<"loading" | "success" | "error">("loading");
  const [errorMsg, setErrorMsg] = useState("");

  useEffect(() => {
    if (!containerRef.current) return;
    
    let isUnmounted = false;

    // Initialize Pixi Application
    const app = new PIXI.Application({
      width: 400,
      height: 400,
      autoStart: true,
      backgroundAlpha: 0,
    });
    
    appRef.current = app;
    containerRef.current.appendChild(app.view as HTMLCanvasElement);

    const loadModel = async () => {
      try {
        // Dynamically import to ensure window.PIXI is ready
        const { Live2DModel } = await import('pixi-live2d-display');
        
        // Register Ticker for Live2D (Required for some versions)
        Live2DModel.registerTicker(PIXI.Ticker);
        
        // Use the open source Shizuku model
        const modelUrl = "https://cdn.jsdelivr.net/gh/guansss/pixi-live2d-display/test/assets/shizuku/shizuku.model.json";
        
        const model = await Live2DModel.from(modelUrl, { autoInteract: false });
        
        // Check if component unmounted while downloading
        if (isUnmounted || !app.stage) {
          model.destroy();
          return;
        }
        
        modelRef.current = model;
        app.stage.addChild(model);
        
        // Scale and position the model
        model.scale.set(0.3); // Adjust scale for Shizuku
        model.x = app.view.width / 2;
        model.y = app.view.height / 2 + 100; // Shift down slightly
        model.anchor.set(0.5, 0.5);
        
        // Make the model follow the mouse
        const canvasView = app.view as unknown as HTMLCanvasElement;
        canvasView.addEventListener('pointermove', (e: any) => {
            const rect = canvasView.getBoundingClientRect();
            // Convert to clip space (-1 to 1) for focus
            const x = ((e.clientX - rect.left) / rect.width) * 2 - 1;
            const y = ((e.clientY - rect.top) / rect.height) * 2 - 1;
            model.focus(x, y);
        });
        
        setLoadStatus("success");
      } catch (err: any) {
        // Ignore errors if component unmounted
        if (isUnmounted) return;
        
        console.error("Failed to load Live2D model:", err);
        setLoadStatus("error");
        setErrorMsg(err.message || String(err));
      }
    };

    loadModel();

    return () => {
      isUnmounted = true;
      // Clean up on unmount
      if (appRef.current) {
        appRef.current.destroy(true, { children: true });
        appRef.current = null;
      }
    };
  }, []);

  // Handle Lip Sync / Speaking State
  useEffect(() => {
    if (!modelRef.current) return;
    const model = modelRef.current;
    
    if (isSpeaking) {
      if (!tickerRef.current) {
        const ticker = new PIXI.Ticker();
        tickerRef.current = ticker;
        
        let mouthOpen = false;
        let frameCount = 0;
        
        ticker.add(() => {
          frameCount++;
          // Toggle mouth open/close every few frames (approx 10-15 frames per toggle)
          if (frameCount % 6 === 0) {
            mouthOpen = Math.random() > 0.3; // 70% chance to open, 30% to close
          }
          
          if (model.internalModel && model.internalModel.coreModel) {
               model.internalModel.coreModel.setParamFloat('PARAM_MOUTH_OPEN_Y', mouthOpen ? (Math.random() * 0.5 + 0.5) : 0);
          }
        });
        ticker.start();
      }
    } else {
       if (tickerRef.current) {
         tickerRef.current.destroy();
         tickerRef.current = null;
       }
       if (model.internalModel && model.internalModel.coreModel) {
             model.internalModel.coreModel.setParamFloat('PARAM_MOUTH_OPEN_Y', 0);
       }
    }
    
    return () => {
      if (tickerRef.current) {
         tickerRef.current.destroy();
         tickerRef.current = null;
      }
    };
  }, [isSpeaking]);

  return (
    <div className="live2d-container" style={{ width: 400, height: 400, margin: '0 auto', display: 'flex', justifyContent: 'center', position: 'relative' }}>
      {loadStatus === "loading" && <div style={{ position: 'absolute', top: '50%', color: 'cyan', fontFamily: 'monospace' }}>Initializing Avatar...</div>}
      {loadStatus === "error" && (
        <div style={{ position: 'absolute', top: '40%', color: '#ff4444', fontFamily: 'monospace', textAlign: 'center', padding: '0 20px' }}>
          <div>Failed to load Avatar</div>
          <div style={{ fontSize: '10px', marginTop: '10px', opacity: 0.8 }}>{errorMsg}</div>
        </div>
      )}
      <div ref={containerRef} style={{ width: '100%', height: '100%', opacity: loadStatus === 'success' ? 1 : 0, transition: 'opacity 0.5s' }} />
    </div>
  );
}
