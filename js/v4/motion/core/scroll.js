// Scroll backbone (owner M1): Lenis (tier 2 + fine pointer only), the per-frame shared state (scroll, pointer),
// chapter tracking, page-background theme interpolation, header hide/show, mobile dock and smooth anchor links.
// Runs on requestAnimationFrame until GSAP is up, then on gsap.ticker (after Lenis, so state reads this frame's scroll).
const PALETTE = { // theme -> [bg token, fallback]
  paper: ['--c-paper', '#f2f4ee'], dark: ['--c-dark', '#121812'], sage: ['--c-sage', '#8f9a8c'], mist: ['--c-mist', '#dfe5da'],
};
const BLEND = 0.25; // half-width of the background blend zone around a chapter boundary, in viewport heights

const parse = (s) => {
  s = (s || '').trim();
  let m = s.match(/^#([\da-f]{3}|[\da-f]{6})$/i);
  if (m) {
    const h = m[1].length === 3 ? m[1].replace(/./g, '$&$&') : m[1];
    return [0, 2, 4].map((i) => parseInt(h.slice(i, i + 2), 16));
  }
  m = s.match(/^rgba?\(\s*(\d+)[\s,]+(\d+)[\s,]+(\d+)/i);
  return m ? [+m[1], +m[2], +m[3]] : null;
};

export function initScroll(ctx, ui) {
  const { bus, state, root } = ctx;
  const body = document.body;
  const chapters = [...document.querySelectorAll('[data-chapter]')];
  const info = chapters.map((el) => ({
    id: el.dataset.chapter || el.id, theme: el.dataset.theme || 'dark', mood: el.dataset.mood || 'lobby', scene: el.dataset.scene || 'none', el,
  }));
  const hero = document.getElementById('hero') || chapters[0];
  const footer = document.getElementById('continue');
  const dock = document.getElementById('dock');
  const header = document.querySelector('.site-header');
  const css = getComputedStyle(root);
  const colors = {};
  for (const k in PALETTE) colors[k] = parse(css.getPropertyValue(PALETTE[k][0])) || parse(PALETTE[k][1]);
  const colorOf = (theme) => colors[theme] || colors.dark;
  const themeMeta = document.querySelector('meta[name="theme-color"]');

  let lenis = null, raf = 0, ticking = false;
  let vh = innerHeight, vw = innerWidth, max = 1, edges = [], heroEnd = 0, footTop = Infinity, headerH = 64;
  let lastT = 0, lastY = -1, v = 0, cur = -1, acc = 0;
  let tx = vw / 2, ty = vh / 2, px = tx, py = ty;
  let bgKey = '', uiTheme = '', hidden = false, scrolled = null, dockOn = null, override = null;

  const scrollTop = () => (lenis ? lenis.scroll : window.scrollY);

  function measure() {
    vh = innerHeight; vw = innerWidth;
    const y = window.scrollY;
    max = Math.max(1, document.documentElement.scrollHeight - vh);
    // a pinned chapter is measured by its pin-spacer, which keeps its place (and its scroll length) in the flow
    const ranges = chapters.map((el) => {
      const box = el.parentElement?.classList.contains('pin-spacer') ? el.parentElement : el;
      const r = box.getBoundingClientRect();
      return { top: r.top + y, bottom: r.bottom + y };
    });
    edges = ranges.map((r, i) => (i ? (ranges[i - 1].bottom + r.top) / 2 : -Infinity));
    const hi = chapters.indexOf(hero);
    heroEnd = hi >= 0 ? ranges[hi].bottom : vh;
    const fi = chapters.indexOf(footer);
    footTop = fi >= 0 ? ranges[fi].top : Infinity;
    if (header) headerH = header.offsetHeight || headerH;
  }

  const indexAt = (line) => {
    let i = 0;
    while (i + 1 < edges.length && edges[i + 1] <= line) i++;
    return i;
  };

  function setUi(theme) {
    if (theme === uiTheme) return;
    uiTheme = theme;
    root.dataset.ui = theme;
    if (themeMeta) themeMeta.content = `rgb(${colorOf(theme).join(',')})`; // browser chrome on phones
  }

  function frame(now) {
    const dt = Math.min(100, Math.max(1, now - (lastT || now - 16.7)));
    lastT = now;
    const y = scrollTop();
    if (lastY < 0) lastY = y;
    const dy = y - lastY;
    lastY = y;
    // velocity: signed px per 60 Hz frame, smoothed; pointer: smoothed position
    const raw = Math.max(-300, Math.min(300, dy * (16.667 / dt)));
    v += (raw - v) * (1 - Math.exp(-dt / 80));
    if (Math.abs(v) < 0.005) v = 0;
    const k = 1 - Math.exp(-dt / 90);
    px += (tx - px) * k; py += (ty - py) * k;
    const s = state.scroll, p = state.pointer;
    s.y = y; s.progress = Math.min(1, Math.max(0, y / (lenis ? lenis.limit || max : max))); s.velocity = v;
    p.x = px; p.y = py; p.nx = (px / vw) * 2 - 1; p.ny = (py / vh) * 2 - 1;

    if (info.length) {
      // chapter = the one under the viewport centre line
      const line = y + vh / 2;
      const i = indexAt(line);
      if (i !== cur) {
        const direction = cur < 0 ? 1 : Math.sign(i - cur);
        cur = i;
        state.chapter = info[i];
        bus.emit('chapter', { ...info[i], direction });
      }
      if (root.classList.contains('motion-on')) {
        // background: blend between adjacent chapter themes while their boundary crosses the middle of the viewport
        let a = info[i].theme, b = a, t = 0;
        if (override) ({ from: a, to: b, t } = override);
        else {
          const Z = vh * BLEND, up = line - edges[i], down = (edges[i + 1] ?? Infinity) - line;
          if (i > 0 && up < Z && up <= down) { a = info[i - 1].theme; b = info[i].theme; t = 0.5 + up / (2 * Z); }
          else if (down < Z) { a = info[i].theme; b = info[i + 1].theme; t = 0.5 - down / (2 * Z); }
        }
        t = Math.min(1, Math.max(0, t));
        t = t * t * (3 - 2 * t);
        const ca = colorOf(a), cb = colorOf(b);
        const c = ca.map((x, j) => Math.round(x + (cb[j] - x) * t));
        const key = c.join(',');
        if (key !== bgKey) {
          bgKey = key;
          body.style.backgroundColor = `rgb(${key})`;
          // the page is one colour, so the header follows the dominant theme of the blend
          setUi(t < 0.5 ? a : b);
        }
      } else {
        // static themes (reduced motion, or motion not up yet): the chapter under the header
        setUi(info[indexAt(y + headerH / 2)].theme);
      }
    }

    if (header) {
      const locked = root.classList.contains('menu-open') || root.classList.contains('gate-on') || header.contains(document.activeElement);
      let hide = hidden;
      if (y < Math.max(120, vh * 0.15) || locked) { acc = 0; hide = false; }
      else if (dy) {
        if ((dy > 0) !== (acc > 0)) acc = 0;
        acc += dy;
        if (acc > 60) hide = true; else if (acc < -30) hide = false;
      }
      if (hide !== hidden) { hidden = hide; root.classList.toggle('header-hidden', hide); }
      const sc = y > 12;
      if (sc !== scrolled) { scrolled = sc; root.classList.toggle('is-scrolled', sc); }
    }
    if (dock) {
      const on = y > heroEnd - vh * 0.5 && y + vh * 0.65 < footTop;
      if (on !== dockOn) { dockOn = on; dock.classList.toggle('is-on', on); dock.inert = !on; }
    }
  }

  const loop = (t) => { frame(t); if (!ticking) raf = requestAnimationFrame(loop); };
  addEventListener('pointermove', (e) => { tx = e.clientX; ty = e.clientY; }, { passive: true });
  let rt = 0;
  addEventListener('resize', () => { clearTimeout(rt); rt = setTimeout(() => (ui.ST ? ui.ST.refresh() : measure()), 150); });
  let lastH = document.documentElement.scrollHeight, lastScroll = 0;
  addEventListener('scroll', () => { lastScroll = performance.now(); }, { passive: true });
  // never mid-scroll: ScrollTrigger.refresh() puts back the scroll position it saw, which stops a native smooth scroll
  // (phones: a "See sim rates" tap switches the rates tab, the page height changes and the jump to #rates halted)
  const refreshWhenIdle = () => {
    clearTimeout(rt);
    rt = setTimeout(() => (performance.now() - lastScroll < 150 ? refreshWhenIdle() : ui.ST ? ui.ST.refresh() : measure()), 200);
  };
  new ResizeObserver(() => {
    const h = document.documentElement.scrollHeight;
    if (Math.abs(h - lastH) < 2) return;
    lastH = h;
    refreshWhenIdle();
  }).observe(body);
  measure();
  frame(performance.now());
  raf = requestAnimationFrame(loop);

  /* ── smooth anchors: Lenis when present, native otherwise; focus moves to the target for keyboard users ── */
  const focusTarget = (el) => {
    if (!el || el === document.body) return;
    if (!el.matches('a[href], button, input, select, textarea, [tabindex]')) el.setAttribute('tabindex', '-1');
    el.focus({ preventScroll: true });
  };
  function scrollTo(target, opts = {}) {
    const el = typeof target === 'string' ? document.querySelector(target) : target;
    if (lenis) return lenis.scrollTo(el ?? target, { duration: 1.2, ...opts });
    const top = typeof el === 'number' ? el : el ? el.getBoundingClientRect().top + window.scrollY + (opts.offset || 0) : 0;
    window.scrollTo({ top, behavior: state.reduce || opts.immediate ? 'auto' : 'smooth' });
    if (opts.onComplete) setTimeout(opts.onComplete, state.reduce || opts.immediate ? 0 : 900);
  }
  document.addEventListener('click', (e) => {
    if (!lenis || e.defaultPrevented || e.button || e.metaKey || e.ctrlKey || e.shiftKey || e.altKey) return;
    const a = e.target.closest?.('a[href^="#"]');
    if (!a) return;
    const id = decodeURIComponent(a.getAttribute('href').slice(1));
    const el = id ? document.getElementById(id) : null;
    if (id && !el && id !== 'top') return;
    e.preventDefault();
    ui.closeMenu?.();
    const top = !el || el === hero;
    lenis.scrollTo(top ? 0 : el, { duration: 1.2, onComplete: () => focusTarget(el) });
    if (id) history.replaceState(null, '', `#${id}`);
  });

  return {
    measure,
    scrollTo,
    setTheme(from, to = from, t = 1) { override = from ? { from, to, t } : null; },
    attach(gsap, ScrollTrigger, Lenis) {
      ui.ST = ScrollTrigger;
      if (Lenis) {
        lenis = new Lenis({ autoRaf: false, lerp: 0.1, smoothWheel: true, syncTouch: false, allowNestedScroll: true, prevent: (n) => n.id === 'menu' });
        lenis.on('scroll', ScrollTrigger.update);
        gsap.ticker.add((time) => lenis.raf(time * 1000));
        gsap.ticker.lagSmoothing(0);
        if (root.classList.contains('gate-on') || root.classList.contains('menu-open')) lenis.stop();
        bus.on('gate:start', () => { if (!root.classList.contains('menu-open')) lenis.start(); });
        ui.lenis = lenis;
      }
      ticking = true;
      cancelAnimationFrame(raf);
      gsap.ticker.add((time) => frame(time * 1000));
      ScrollTrigger.addEventListener('refresh', measure);
      return lenis;
    },
  };
}
