import { useEffect, useRef } from 'react';
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

  useEffect(() => {
    if (!containerRef.current) return;

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
        
        // Use the open source Shizuku model
        const modelUrl = "https://cdn.jsdelivr.net/gh/guansss/pixi-live2d-display/test/assets/shizuku/shizuku.model.json";
        
        const model = await Live2DModel.from(modelUrl);
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
            const rect = (app.view as HTMLCanvasElement).getBoundingClientRect();
            // Convert to clip space (-1 to 1) for focus
            const x = ((e.clientX - rect.left) / rect.width) * 2 - 1;
            const y = ((e.clientY - rect.top) / rect.height) * 2 - 1;
            model.focus(x, y);
        });
      } catch (err) {
        console.error("Failed to load Live2D model:", err);
      }
    };

    loadModel();

    return () => {
      if (appRef.current) {
        appRef.current.destroy(true, { children: true });
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
      <div ref={containerRef} style={{ width: '100%', height: '100%' }} />
    </div>
  );
}
