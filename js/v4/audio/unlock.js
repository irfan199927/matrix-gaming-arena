// Audio unlock (agent A). Imported statically by main.js, so keep it tiny. Spec §6 "Audio unlock".
// unlock() must run synchronously inside the click/tap handler (iOS needs the gesture).
import { bus } from '../bus.js';

let ac = null, gate = null;

// gate:start can fire before the lazily loaded engine exists; remember it so the engine can still play the start sting.
bus.on('gate:start', (d) => { gate = { sound: !!(d && d.sound), t: performance.now() }; });
export const lastGateStart = () => gate;

export const getContext = () => ac;

export function unlock() {
  try {
    const AC = window.AudioContext || window.webkitAudioContext;
    if (!AC) return null;
    if (!ac || ac.state === 'closed') ac = new AC();
    if (ac.state !== 'running') ac.resume().catch(() => {});
    const s = ac.createBufferSource();          // 1-sample silent buffer: the iOS unlock
    s.buffer = ac.createBuffer(1, 1, ac.sampleRate);
    s.connect(ac.destination);
    s.start(0);
  } catch (e) { console.warn('[audio] unlock failed', e); }
  return ac;
}

// Show the toggle's last state (sound was on last visit). Never starts audio.
try {
  if (localStorage.getItem('mx4-sound') === '1') {
    const mark = () => document.getElementById('soundToggle')?.setAttribute('data-last', 'on');
    if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', mark, { once: true }); else mark();
  }
} catch { /* storage blocked */ }
