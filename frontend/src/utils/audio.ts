export const getAudioContext = () => {
  const AudioContext = window.AudioContext || (window as any).webkitAudioContext;
  if (!AudioContext) return null;
  return new AudioContext();
};

export const playChime = () => {
  const ctx = getAudioContext();
  if (!ctx) return;
  
  const osc = ctx.createOscillator();
  const gain = ctx.createGain();
  
  osc.type = 'sine';
  osc.frequency.setValueAtTime(880, ctx.currentTime); // A5
  osc.frequency.exponentialRampToValueAtTime(1760, ctx.currentTime + 0.1); // A6
  
  gain.gain.setValueAtTime(0, ctx.currentTime);
  gain.gain.linearRampToValueAtTime(0.2, ctx.currentTime + 0.05);
  gain.gain.exponentialRampToValueAtTime(0.001, ctx.currentTime + 0.5);
  
  osc.connect(gain);
  gain.connect(ctx.destination);
  
  osc.start();
  osc.stop(ctx.currentTime + 0.5);
};

export const playSnap = () => {
  const ctx = getAudioContext();
  if (!ctx) return;
  
  const osc = ctx.createOscillator();
  const gain = ctx.createGain();
  
  // A sharp, percussive click
  osc.type = 'triangle';
  osc.frequency.setValueAtTime(300, ctx.currentTime);
  osc.frequency.exponentialRampToValueAtTime(50, ctx.currentTime + 0.05);
  
  gain.gain.setValueAtTime(0, ctx.currentTime);
  gain.gain.linearRampToValueAtTime(0.3, ctx.currentTime + 0.01);
  gain.gain.exponentialRampToValueAtTime(0.001, ctx.currentTime + 0.1);
  
  osc.connect(gain);
  gain.connect(ctx.destination);
  
  osc.start();
  osc.stop(ctx.currentTime + 0.1);
};

export const playAlarm = () => {
  const ctx = getAudioContext();
  if (!ctx) return;
  
  const osc = ctx.createOscillator();
  const lfo = ctx.createOscillator();
  const gain = ctx.createGain();
  const lfoGain = ctx.createGain();
  
  // Suspenseful low sawtooth drone
  osc.type = 'sawtooth';
  osc.frequency.setValueAtTime(55, ctx.currentTime); // Low A1
  
  lfo.type = 'sine';
  lfo.frequency.setValueAtTime(5, ctx.currentTime); // 5Hz vibration
  
  lfoGain.gain.setValueAtTime(15, ctx.currentTime); // modulate pitch by 15Hz
  
  gain.gain.setValueAtTime(0, ctx.currentTime);
  gain.gain.linearRampToValueAtTime(0.15, ctx.currentTime + 0.5);
  gain.gain.exponentialRampToValueAtTime(0.001, ctx.currentTime + 2.0);
  
  lfo.connect(lfoGain);
  lfoGain.connect(osc.frequency);
  
  osc.connect(gain);
  gain.connect(ctx.destination);
  
  lfo.start();
  osc.start();
  
  lfo.stop(ctx.currentTime + 2.0);
  osc.stop(ctx.currentTime + 2.0);
};
