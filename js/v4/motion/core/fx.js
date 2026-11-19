// Generic motion helpers (owner M1): split, reveal, parallax, marquee, scramble (MATRIX decode), count, draw.
// `auto()` applies them to the data-* hooks in the markup, skipping anything M2 claimed with [data-m2].
// Tier 0 gets simple fades only; reduced motion gets the final states (CSS keeps nothing hidden).
const KANA = 'アカサタナハマヤラワ0123456789';
const SHAPES = 'path, line, polyline, polygon, circle, ellipse, rect';

export function initFx(ctx, { gsap, ScrollTrigger, SplitText }) {
  const { state } = ctx;
  const reduce = state.reduce, lite = state.tier === 0;
  const still = reduce || lite; // no movement beyond fades
  const later = (fn) => ctx.onReady(fn);
  const armed = (el) => el.classList.add('mx-armed');
  const splits = new Map(), scrambles = new Map(), marquees = new Set();

  /* split: SplitText.create, cached per element; lines get masks and re-split on resize (autoSplit) */
  function split(el, type = el.dataset.split || 'words', vars = {}) {
    if (splits.has(el)) return splits.get(el);
    const lines = type === 'lines';
    const s = SplitText.create(el, {
      type: lines ? 'lines' : type === 'chars' ? 'words,chars' : 'words',
      mask: lines ? 'lines' : undefined,
      autoSplit: lines,
      aria: /^H[1-6]$/.test(el.tagName) ? 'auto' : 'none',
      linesClass: 'mx-line', wordsClass: 'mx-word', charsClass: 'mx-char',
      ...vars,
    });
    splits.set(el, s);
    armed(el);
    return s;
  }

  /* split + staggered reveal when it scrolls in */
  function splitReveal(el, type = el.dataset.split || 'words', opts = {}) {
    if (reduce) return armed(el);
    if (lite) return reveal(el, 'fade', opts);
    const from = type === 'lines' ? { yPercent: 105 } : type === 'chars' ? { yPercent: 60, opacity: 0 } : { y: '0.45em', opacity: 0 };
    const to = {
      yPercent: 0, y: 0, opacity: 1, ease: 'expo.out', duration: type === 'lines' ? 1.15 : 0.9,
      stagger: type === 'chars' ? 0.028 : type === 'words' ? 0.045 : 0.09, delay: opts.delay ?? (+el.dataset.delay || 0),
    };
    let tw = null, played = false;
    split(el, type, {
      onSplit(self) {
        tw = gsap.fromTo(self[type], from, { ...to, paused: !played });
        return tw;
      },
    });
    return ScrollTrigger.create({ trigger: el, start: opts.start || 'top 88%', once: true, onEnter: () => later(() => { played = true; tw?.play(); }) });
  }

  /* reveal: up | fade | clip; [data-stagger] reveals the children one by one */
  function reveal(el, kind = el.dataset.reveal || 'up', opts = {}) {
    if (reduce) return armed(el);
    if (lite) kind = 'fade';
    const targets = el.hasAttribute('data-stagger') ? [...el.children] : [el];
    const from = kind === 'fade' ? { opacity: 0 } : kind === 'clip' ? { clipPath: 'inset(100% 0% 0% 0%)' } : { opacity: 0, y: 48 };
    const to = kind === 'clip'
      ? { clipPath: 'inset(0% 0% 0% 0%)', duration: 1.3, ease: 'expo.inOut', clearProps: 'clipPath' }
      : { opacity: 1, y: 0, duration: kind === 'fade' ? 0.9 : 1.1, ease: 'expo.out', clearProps: 'opacity,transform' };
    gsap.set(targets, from);
    armed(el);
    const play = () => gsap.to(targets, { ...to, delay: opts.delay ?? (+el.dataset.delay || 0), stagger: targets[0] === el ? 0 : (+el.dataset.stagger || 0.08) });
    return ScrollTrigger.create({ trigger: el, start: opts.start || 'top 88%', once: true, onEnter: () => later(play) });
  }

  /* parallax: positive factors lag behind the scroll (deeper), negative ones lead */
  function parallax(el, f = parseFloat(el.dataset.parallax) || 0.2) {
    if (still) return null;
    if (state.tier === 1) f *= 0.5;
    const d = () => f * (innerHeight + el.offsetHeight) / 2;
    return gsap.fromTo(el, { y: () => -d() }, {
      y: () => d(), ease: 'none',
      scrollTrigger: { trigger: el, start: 'top bottom', end: 'bottom top', scrub: true, invalidateOnRefresh: true },
    });
  }

  /* marquee: [data-marquee] > .marquee-track holding the content twice (loops at -50%); speed rises with scroll velocity */
  function marquee(el, { dir = el.dataset.marquee === 'right' ? 1 : -1, speed = +(el.dataset.speed || 70), boost = 25 } = {}) {
    let track = el.querySelector('.marquee-track');
    if (!track) { // generic markup: wrap and duplicate once
      track = document.createElement('div');
      track.className = 'marquee-track';
      track.append(...el.childNodes);
      const copy = track.cloneNode(true);
      copy.setAttribute('aria-hidden', 'true');
      track.append(...copy.childNodes);
      el.append(track);
    }
    const h = { el, track, dir, speed, boost, paused: still, x: 0, half: 0, on: false };
    const size = () => { h.half = track.scrollWidth / 2; };
    size();
    new ResizeObserver(size).observe(track);
    new IntersectionObserver(([e]) => { h.on = e.isIntersecting; }).observe(el);
    marquees.add(h);
    return Object.assign(h, {
      set(o) { Object.assign(h, o); return h; },
      pause() { h.paused = true; return h; },
      play() { h.paused = still; return h; },
      kill() { marquees.delete(h); track.style.transform = ''; },
    });
  }
  gsap.ticker.add((t, dtMs) => {
    if (!marquees.size) return;
    const v = Math.abs(state.scroll.velocity);
    for (const h of marquees) {
      if (h.paused || !h.on || !h.half) continue;
      h.x = (h.x + (h.speed + Math.min(900, v * h.boost)) * Math.min(dtMs, 64) / 1000) % h.half;
      h.track.style.transform = `translate3d(${(h.dir < 0 ? -h.x : h.x - h.half).toFixed(2)}px,0,0)`;
    }
  });

  /* scramble: the MATRIX decode from the draft. Katakana flicker that locks left to right, then rare 1–2 letter glitches */
  function scramble(el) {
    if (scrambles.has(el)) return scrambles.get(el);
    const chs = [];
    const walker = document.createTreeWalker(el, NodeFilter.SHOW_TEXT);
    const nodes = [];
    while (walker.nextNode()) nodes.push(walker.currentNode);
    nodes.forEach((n) => {
      const frag = document.createDocumentFragment();
      for (const c of n.data) {
        if (/\s/.test(c)) { frag.append(c); continue; }
        const s = document.createElement('span');
        s.className = 'mx-ch';
        s.textContent = c;
        frag.append(s);
        chs.push(s);
      }
      n.replaceWith(frag);
    });
    const real = chs.map((c) => c.textContent);
    const rnd = () => KANA[Math.floor(Math.random() * KANA.length)];
    const restore = (i) => { chs[i].textContent = real[i]; chs[i].classList.remove('is-glitch'); };
    const glyph = (i) => {
      const g = rnd();
      chs[i].innerHTML = /\d/.test(g) ? g : `<span class="mx-kana">${g}</span>`;
      chs[i].classList.add('is-glitch');
    };
    const lock = () => {
      chs.forEach((c) => { c.style.width = ''; });
      const w = chs.map((c) => c.getBoundingClientRect().width);
      chs.forEach((c, i) => { c.style.width = `${w[i]}px`; });
    };
    const fonts = (document.fonts ? document.fonts.ready : Promise.resolve()).then(lock);
    let rt = 0;
    addEventListener('resize', () => { clearTimeout(rt); rt = setTimeout(() => { chs.forEach((_, i) => restore(i)); lock(); }, 150); });
    const flicker = (i, ms) => new Promise((res) => {
      const end = performance.now() + ms;
      const step = () => { if (performance.now() >= end) { restore(i); return res(); } glyph(i); setTimeout(step, 55); };
      step();
    });
    let visible = true, idleT = 0;
    new IntersectionObserver(([e]) => { visible = e.isIntersecting; }).observe(el);
    const idle = () => {
      clearTimeout(idleT);
      idleT = setTimeout(() => {
        if (visible && !document.hidden && chs.length > 2) {
          const a = Math.floor(Math.random() * chs.length);
          flicker(a, 240);
          if (Math.random() > 0.5) flicker((a + 2 + Math.floor(Math.random() * (chs.length - 3))) % chs.length, 200);
        }
        idle();
      }, 5500 + Math.random() * 3500);
    };
    const h = {
      chars: chs,
      decode(stagger = 140, base = 600) {
        if (still) return Promise.resolve();
        return fonts.then(() => Promise.all(chs.map((_, i) => flicker(i, base + i * stagger)))).then(() => { idle(); });
      },
      glitch(n = 1) { if (!still) for (let k = 0; k < n; k++) flicker(Math.floor(Math.random() * chs.length), 220); },
      stop() { clearTimeout(idleT); chs.forEach((_, i) => restore(i)); },
    };
    scrambles.set(el, h);
    return h;
  }

  /* count: animates the number inside the text from 0 (prefix/suffix kept); the real value ships in the HTML */
  function count(el, opts = {}) {
    const text = el.textContent;
    const to = parseFloat(el.dataset.count ?? text.replace(/[^\d.]/g, ''));
    if (!isFinite(to) || still) return null;
    const dec = +(el.dataset.dec || 0);
    const tpl = /[\d.,]+/.test(text) ? text.replace(/[\d.,]+/, '\u0000') : '\u0000';
    const o = { v: 0 };
    const put = () => { el.textContent = tpl.replace('\u0000', o.v.toFixed(dec)); };
    put();
    return ScrollTrigger.create({
      trigger: el, start: opts.start || 'top 90%', once: true,
      onEnter: () => later(() => gsap.to(o, { v: to, duration: opts.duration || 1.4, ease: 'power3.out', onUpdate: put, onComplete: () => { el.textContent = text; } })),
    });
  }

  /* draw: SVG strokes drawn by scroll (scrubbed) */
  function draw(el, opts = {}) {
    const paths = el.matches(SHAPES) ? [el] : [...el.querySelectorAll(SHAPES)];
    if (!paths.length || still) return null;
    paths.forEach((p) => { p.setAttribute('pathLength', '1'); p.style.strokeDasharray = '1'; p.style.strokeDashoffset = '1'; });
    return gsap.to(paths, {
      strokeDashoffset: 0, ease: 'none',
      scrollTrigger: { trigger: opts.trigger || el.closest('svg') || el, start: opts.start || 'top 80%', end: opts.end || 'bottom 40%', scrub: opts.scrub ?? 0.6 },
    });
  }

  /* the generic pass over the markup: everything M2 did not claim */
  function auto(onError) {
    const claimed = (el) => !!el.closest('[data-m2]');
    const each = (sel, fn) => document.querySelectorAll(sel).forEach((el) => {
      if (claimed(el)) return armed(el); // M2 owns it (its from-states are inline by now): just lift the CSS pre-state
      try { fn(el); } catch (e) { armed(el); onError?.(e, el); }
    });
    each('[data-split]', (el) => splitReveal(el));
    each('[data-reveal]', (el) => { if (!el.hasAttribute('data-split')) reveal(el); });
    each('[data-parallax]', (el) => parallax(el));
    each('[data-marquee]', (el) => marquee(el));
    each('[data-count]', (el) => count(el));
    each('[data-draw]', (el) => draw(el));
    each('[data-scramble]', (el) => {
      const h = scramble(el);
      if (el.closest('#hero')) later(() => h.decode());
      else ScrollTrigger.create({ trigger: el, start: 'top 85%', once: true, onEnter: () => later(() => h.decode()) });
    });
  }

  return { api: { split, splitReveal, reveal, parallax, marquee, scramble, count, draw }, auto };
}
