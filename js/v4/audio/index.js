// Audio entry (agent A). main.js imports this lazily on the first sound-on, after unlock(), then calls ctx.audio.setOn(true).
// Owns: #soundToggle aria-pressed, html.sound-on, state.sound, the 'sound' bus event, localStorage['mx4-sound'].
// Silent means idle: when off or hidden, scheduling stops and the AudioContext is suspended.
import { getContext, unlock, lastGateStart } from './unlock.js';
import { createEngine } from './engine.js';

const GAP = { hover: 60, click: 50, tick: 35, open: 120, close: 120, countdown: 150, go: 300, glitch: 600 }; // ms throttles
const SEL = 'a[href], button, [role="button"], [role="tab"], summary, label[for], [data-sfx], #modes [data-mode]';

export function init(ctx) {
  const { bus, state } = ctx, html = document.documentElement;
  const ac = getContext() || unlock();
  if (!ac) return (ctx.audio = { setOn() {}, toggle() {}, isOn: () => false });
  const eng = createEngine(ac, { lite: state.tier < 2 || state.touch });
  const last = {};
  let on = false, hidden = document.hidden, timer = 0, offT = 0, sting = false, lastBus = 0, hov = null;
  eng.setMood(state.chapter?.mood || 'lobby', ac.currentTime, true);

  const resume = () => { if (ac.state !== 'running') ac.resume().catch(() => {}); };
  const loop = () => { // lookahead scheduler: timers wake us, AudioContext time places the notes
    timer = setTimeout(loop, 40);
    const t = ac.currentTime;
    eng.tick(t, 0.25);
    eng.rev(state.scroll?.velocity || 0, t, state.tach);
  };
  const run = () => { if (timer || !on || hidden) return; resume(); eng.start(ac.currentTime + 0.08); loop(); };
  const halt = (d) => { // fade, then stop scheduling and suspend the context (no CPU while silent)
    eng.fadeOut(ac.currentTime, d);
    clearTimeout(offT);
    offT = setTimeout(() => { clearTimeout(timer); timer = 0; eng.stop(ac.currentTime); ac.suspend().catch(() => {}); }, d * 1000 + 60);
  };

  function setOn(v) {
    v = !!v;
    if (v === on) return;
    on = v; state.sound = v;
    html.classList.toggle('sound-on', v);
    const b = document.getElementById('soundToggle');
    if (b) { b.setAttribute('aria-pressed', String(v)); b.removeAttribute('data-last'); }
    try { localStorage.setItem('mx4-sound', v ? '1' : '0'); } catch { /* storage blocked */ }
    bus.emit('sound', { on: v });
    if (!v) return halt(0.4);
    clearTimeout(offT);
    if (hidden) return;
    resume(); eng.fadeIn(ac.currentTime, 1.5); run();
    if (sting) { sting = false; eng.sting(ac.currentTime + 0.02); }
  }

  function ui(kind, el, fromBus) {
    if (!on || hidden || !GAP[kind]) return;
    const now = performance.now(), t = ac.currentTime;
    if (fromBus && kind !== 'hover') lastBus = now;
    else if (kind === 'click' && now - lastBus < 90) return; // the page already sent an explicit sound for this gesture
    const card = kind === 'hover' && el?.closest?.('#modes [data-mode]'); // mode cards: a.mode[data-mode=ps5|sim|vr]
    if (card) {
      const m = card.dataset.mode, k = 'm' + m;
      if (now - (last[k] || 0) > 700) { last[k] = last.hover = now; eng.motif(m, t); }
      return;
    }
    if (now - (last[kind] || 0) < GAP[kind]) return;
    last[kind] = now; eng.sfx(kind, t);
  }
  const allow = (el, kind) => {
    const s = el.getAttribute('data-sfx');
    if (s != null) return s.split(/\s+/).includes(kind);
    return !(kind === 'click' && el.closest('#soundToggle, [data-start]'));
  };

  // the start sting: gate:start may have fired before this module loaded (see unlock.js)
  const g = lastGateStart();
  if (g && g.sound && performance.now() - g.t < 4000) sting = true;
  bus.on('gate:start', (d) => { if (d?.sound) { if (on && !hidden) eng.sting(ac.currentTime + 0.02); else sting = true; } });
  bus.on('chapter', (d) => { if (d?.mood) eng.setMood(d.mood, ac.currentTime); });
  bus.on('ui', (d) => { if (d) ui(d.kind, d.el, true); });
  document.addEventListener('pointerover', (e) => {
    if (e.pointerType && e.pointerType !== 'mouse') return;
    const el = e.target.closest?.(SEL) || null;
    if (el === hov) return;
    hov = el;
    if (el && allow(el, 'hover')) ui('hover', el);
  }, { passive: true });
  document.addEventListener('click', (e) => { const el = e.target.closest?.(SEL); if (el && allow(el, 'click')) ui('click', el); }, { passive: true });
  document.addEventListener('visibilitychange', () => {
    hidden = document.hidden;
    if (!on) return;
    if (hidden) return halt(0.12);
    clearTimeout(offT); resume(); eng.fadeIn(ac.currentTime, 0.8); run();
  });

  ctx.audio = {
    setOn, toggle: () => setOn(!on), isOn: () => on,
    debug: () => ({ ctx: ac.state, scheduling: !!timer, running: eng.running, mood: eng.mood, engine: eng.engine }),
  };
  return ctx.audio;
}
