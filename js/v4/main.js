// V4 boot (owner: Motion core). Contract: redesign-docs/v4/00-spec.md §5–§7.
// The only static import is bus.js, so no other module can stop the page from booting: everything else is
// loaded with import() and fails soft (one log line, content stays readable, the title screen always ends).
import { bus, state } from './bus.js';

const root = document.documentElement;
const $ = (s, el = document) => el.querySelector(s);
const here = (p) => new URL(p, import.meta.url).href;
const warn = (what, e) => console.warn(`[v4] ${what} unavailable:`, e?.message || e);
const fail = (what, e) => console.error(`[v4] ${what} failed`, e);
const ctx = { bus, state, root };
let isReady = false, sectionsDoneFn = () => {};

const ready = () => {
  if (isReady) return;
  isReady = true;
  root.classList.add('is-ready');
  bus.emit('ready');
};
// `ready` is a one-off event that may fire before a lazily loaded module subscribes: use ctx.onReady(fn).
ctx.onReady = (fn) => {
  if (isReady) return void fn();
  const off = bus.on('ready', () => { off(); fn(); });
};

// Makes everything outside `keep` inert (siblings along each kept element's path up to <body>); returns the undo.
ctx.inertExcept = (keep) => {
  const path = new Set();
  keep.filter(Boolean).forEach((el) => { for (let n = el; n && n !== document.body; n = n.parentElement) path.add(n); });
  const done = [];
  path.forEach((n) => {
    for (const sib of n.parentElement?.children || []) {
      if (path.has(sib) || sib.inert || /^(SCRIPT|STYLE|LINK|TEMPLATE)$/.test(sib.tagName)) continue;
      sib.inert = true;
      done.push(sib);
    }
  });
  return () => done.forEach((el) => { el.inert = false; });
};

try {
  /* ── tier (?tier=0|1|2 overrides the head script's decision, for QA) ── */
  const forced = new URLSearchParams(location.search).get('tier');
  if (/^[012]$/.test(forced || '')) root.dataset.tier = forced;
  state.tier = Number(root.dataset.tier ?? 0) || 0;
  const fine = matchMedia('(hover: hover) and (pointer: fine)').matches;
  const smooth = state.tier === 2 && fine && !state.reduce;
  bus.emit('boot', { tier: state.tier });

  /* ── vendor libraries: classic UMD scripts, downloaded in parallel, executed in order ── */
  const script = (src) => new Promise((res, rej) => {
    const s = Object.assign(document.createElement('script'), { src: here(src), async: false });
    s.onload = res;
    s.onerror = () => rej(new Error(`${src} did not load`));
    document.head.append(s);
  });
  const libs = Promise.all([
    script('../../vendor/gsap/gsap.min.js'),
    script('../../vendor/gsap/ScrollTrigger.min.js'),
    script('../../vendor/gsap/SplitText.min.js'),
    smooth && script('../../vendor/lenis/lenis.min.js').catch((e) => warn('lenis', e)),
  ]).then(() => ({ gsap: window.gsap, ScrollTrigger: window.ScrollTrigger, SplitText: window.SplitText, Lenis: smooth ? window.Lenis : null }));
  libs.catch(() => {});
  // fetch the motion core's own modules alongside its entry instead of one round trip later
  ['index', 'core/scroll', 'core/menu', 'core/pointer', 'core/fx', 'core/hours', 'core/tabs'].forEach((p) => {
    document.head.append(Object.assign(document.createElement('link'), { rel: 'modulepreload', href: here(`motion/${p}.js`) }));
  });

  /* ── audio: unlock() must run synchronously inside the click, so its tiny module is fetched up front ── */
  let unlockFn = null, audioP = null;
  const toggle = $('#soundToggle');
  if (toggle || $('[data-start="sound"]')) import('./audio/unlock.js').then((m) => { unlockFn = m.unlock; }, (e) => warn('audio unlock', e));
  const unlock = () => { try { unlockFn?.(); } catch (e) { fail('audio unlock', e); } };
  const loadAudio = () => (audioP ||= import('./audio/index.js').then(
    (m) => Promise.resolve().then(() => m.init?.(ctx)).then(() => ctx.audio, (e) => fail('audio init', e)),
    (e) => warn('audio', e),
  ));
  const soundOn = () => loadAudio().then((a) => { try { a?.setOn(true); } catch (e) { fail('audio', e); } });
  toggle?.addEventListener('click', () => {
    if (ctx.audio) { try { ctx.audio.toggle(); } catch (e) { fail('audio toggle', e); } return; }
    unlock();
    soundOn();
  });
  bus.on('sound', (d) => toggle?.setAttribute('aria-pressed', String(!!d?.on)));

  /* ── title screen (spec §6) ── */
  const startEl = $('#start');
  const hashTarget = () => { try { return location.hash.length > 1 && !!document.getElementById(decodeURIComponent(location.hash.slice(1))); } catch (e) { return false; } };
  let gated = root.classList.contains('gate-on');
  if (gated && (!startEl || state.tier === 0 || state.reduce || /[?&]nogate\b/.test(location.search) || hashTarget())) {
    root.classList.remove('gate-on');
    gated = false;
  }
  ctx.gated = gated;
  if (gated) {
    const soundBtn = $('[data-start="sound"]', startEl), muteBtn = $('[data-start="mute"]', startEl);
    const btns = [soundBtn, muteBtn].filter(Boolean);
    const restore = ctx.inertExcept([startEl]);
    const offs = [];
    const on = (t, type, fn, o) => { t.addEventListener(type, fn, o); offs.push(() => t.removeEventListener(type, fn, o)); };
    let timer = 0, hover = false, keyed = false, lastMove = 0, touchY = null;
    // attract mode: 5 s without input starts muted; paused while the buttons are hovered or keyboard-focused
    const arm = () => {
      clearTimeout(timer);
      const paused = hover || (keyed && btns.includes(document.activeElement));
      startEl.dataset.idle = paused ? 'paused' : 'run';
      if (!paused) timer = setTimeout(() => start(false, 'idle'), 5000);
    };
    const start = (sound, via) => {
      if (!gated) return;
      gated = false;
      try { sessionStorage.setItem('mx4-start', '1'); } catch (e) { /* private mode */ }
      clearTimeout(timer);
      offs.forEach((f) => f());
      restore();
      const hadFocus = startEl.contains(document.activeElement);
      root.classList.remove('gate-on');
      root.classList.add('is-ready');
      if (hadFocus) {
        const main = $('#main') || $('main');
        if (main) { if (!main.hasAttribute('tabindex')) main.tabIndex = -1; main.focus({ preventScroll: true }); }
      }
      bus.emit('gate:start', { sound, via });
      ready();
      if (sound) soundOn();
    };
    ctx.start = start;
    on(window, 'keydown', (e) => {
      if (e.key === 'Escape') { e.preventDefault(); return start(false, 'esc'); }
      const onBtn = e.target instanceof Element && e.target.closest('button, a');
      if (/^(ArrowDown|PageDown|End)$/.test(e.key) || (e.key === ' ' && !onBtn)) { e.preventDefault(); return start(false, 'key'); }
      keyed = true;
      setTimeout(arm);
    });
    on(window, 'wheel', (e) => { if (e.deltaY || e.deltaX) start(false, 'wheel'); }, { passive: true });
    on(window, 'touchstart', (e) => { touchY = e.touches[0]?.clientY ?? null; arm(); }, { passive: true });
    on(window, 'touchmove', (e) => { if (touchY != null && Math.abs(e.touches[0].clientY - touchY) > 24) start(false, 'swipe'); }, { passive: true });
    on(window, 'pointermove', (e) => {
      if (e.pointerType === 'touch') return;
      const t = performance.now();
      if (t - lastMove > 200) { lastMove = t; arm(); }
    }, { passive: true });
    btns.forEach((b) => {
      on(b, 'pointerenter', (e) => { if (e.pointerType !== 'touch') { hover = true; arm(); } });
      on(b, 'pointerleave', () => { hover = false; arm(); });
      on(b, 'focus', arm);
      on(b, 'blur', () => setTimeout(arm));
    });
    if (soundBtn) on(soundBtn, 'click', () => { unlock(); start(true, 'sound'); });
    if (muteBtn) on(muteBtn, 'click', () => start(false, 'mute'));
    (soundBtn || muteBtn)?.focus({ preventScroll: true });
    arm();
  } else {
    // no title screen: wait for the chapter choreography (about 1.5 s cap) so its entrance can start on `ready`
    ctx.sectionsDone = new Promise((r) => { sectionsDoneFn = r; });
    Promise.race([ctx.sectionsDone, new Promise((r) => setTimeout(r, 1500))]).then(ready);
  }

  /* ── 3D stage: as early as possible, never awaited ── */
  if (state.tier > 0) {
    import('./gl/index.js').then((m) => m.init?.(ctx), (e) => warn('gl', e)).catch((e) => fail('gl', e));
  }

  /* ── motion core (it hands ctx.motion to the chapter choreography in motion/sections/) ── */
  import('./motion/index.js').then((m) => m.init(ctx, { libs, smooth, fine, sectionsDone: () => sectionsDoneFn() })).catch((e) => {
    sectionsDoneFn();
    fail('motion', e);
    root.classList.add('motion-fail');
    root.classList.remove('motion-on');
  });
} catch (e) {
  // never leave the title screen up or content hidden because boot threw
  fail('boot', e);
  root.classList.remove('gate-on');
  root.classList.add('motion-fail');
  try { ctx.inertExcept([]); } catch (e2) { /* nothing to restore */ }
  document.querySelectorAll('[inert]').forEach((el) => { if (!el.matches('#menu')) el.inert = false; });
  ready();
}
