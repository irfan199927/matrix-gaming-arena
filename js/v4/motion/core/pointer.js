// Pointer layer (owner M1): `ui` hover/click events for the audio module (all tiers), the reticle cursor
// (tier 2, fine pointer, motion allowed) and magnetic buttons (fine pointer, motion allowed).
const SEL = 'a[href], button, [role="tab"], [role="button"], summary, label[for], [data-sfx]';
const OFF = 'iframe, input, textarea, select, [contenteditable=""], [contenteditable="true"], [data-cursor="none"]';

export function initPointer(ctx, m) {
  const { bus, state, root } = ctx;
  const { gsap, fine, reduce, tier } = m;

  /* ── ui events (throttled; touch taps still emit click) ── */
  let lastEl = null, lastHover = 0, lastClick = 0;
  const hover = (el) => {
    if (el === lastEl) return;
    lastEl = el;
    const t = performance.now();
    if (t - lastHover < 70) return;
    lastHover = t;
    bus.emit('ui', { kind: 'hover', el });
  };
  document.addEventListener('pointerover', (e) => {
    if (e.pointerType === 'touch') return;
    const el = e.target.closest?.(SEL);
    if (el) hover(el); else lastEl = null;
  }, { passive: true });
  document.addEventListener('focusin', (e) => {
    const el = e.target.closest?.(SEL);
    if (el && el.matches(':focus-visible')) hover(el);
  });
  document.addEventListener('click', (e) => {
    const el = e.target.closest?.(SEL);
    const t = performance.now();
    if (!el || t - lastClick < 60) return;
    lastClick = t;
    bus.emit('ui', { kind: 'click', el });
  }, true);

  if (!fine || reduce) return;

  /* ── magnetic: the element leans toward the pointer and springs back ── */
  document.querySelectorAll('[data-magnetic]').forEach((el) => {
    const k = parseFloat(el.dataset.magnetic) || 0.3;
    const xTo = gsap.quickTo(el, 'x', { duration: 0.6, ease: 'power3.out' });
    const yTo = gsap.quickTo(el, 'y', { duration: 0.6, ease: 'power3.out' });
    let r = null;
    el.addEventListener('pointerenter', (e) => {
      if (e.pointerType !== 'mouse') return;
      const b = el.getBoundingClientRect();
      r = { x: b.left + b.width / 2 - gsap.getProperty(el, 'x'), y: b.top + b.height / 2 - gsap.getProperty(el, 'y'), w: b.width, h: b.height };
    });
    el.addEventListener('pointermove', (e) => {
      if (!r || e.pointerType !== 'mouse') return;
      const lim = Math.min(18, r.w * 0.25);
      xTo(Math.max(-lim, Math.min(lim, (e.clientX - r.x) * k)));
      yTo(Math.max(-lim, Math.min(lim, (e.clientY - r.y) * k)));
    });
    el.addEventListener('pointerleave', () => { r = null; xTo(0); yTo(0); });
  });

  if (tier < 2) return;

  /* ── reticle cursor ── */
  const ret = document.createElement('div');
  ret.className = 'mx-reticle is-off';
  ret.setAttribute('aria-hidden', 'true');
  ret.innerHTML = '<i class="mx-reticle__ring"></i><i class="mx-reticle__cross"></i><i class="mx-reticle__dot"></i>';
  const tag = document.createElement('div');
  tag.className = 'mx-cursor-label';
  tag.setAttribute('aria-hidden', 'true');
  document.body.append(ret, tag);
  root.classList.add('has-cursor');

  let x = -100, y = -100, lx = x, ly = y, moved = false, lastTarget = null, text = '';
  const setState = (target) => {
    lastTarget = target;
    const off = !target || !!target.closest(OFF);
    const lab = off ? '' : target.closest('[data-cursor]')?.dataset.cursor || '';
    ret.classList.toggle('is-off', off);
    ret.classList.toggle('is-link', !off && !lab && !!target.closest(SEL));
    ret.classList.toggle('is-label', !!lab);
    if (lab && lab !== text) tag.textContent = lab;
    text = lab || text;
    tag.classList.toggle('is-on', !!lab);
  };
  addEventListener('pointermove', (e) => {
    if (e.pointerType !== 'mouse') return;
    x = e.clientX; y = e.clientY; moved = true;
    if (lastTarget === null) setState(e.target);
  }, { passive: true });
  document.addEventListener('pointerover', (e) => { if (e.pointerType === 'mouse') setState(e.target); }, { passive: true });
  document.addEventListener('pointerout', (e) => { if (!e.relatedTarget) { lastTarget = null; ret.classList.add('is-off'); tag.classList.remove('is-on'); } });
  addEventListener('pointerdown', (e) => {
    if (e.pointerType !== 'mouse') { ret.classList.add('is-off'); tag.classList.remove('is-on'); return; }
    ret.classList.add('is-down');
  }, { passive: true });
  addEventListener('pointerup', () => ret.classList.remove('is-down'), { passive: true });
  // while the page scrolls under a still pointer, re-check what is under it a few times a second
  let lastCheck = 0;
  gsap.ticker.add(() => {
    if (moved) {
      moved = false;
      ret.style.transform = `translate3d(${x}px,${y}px,0)`;
    }
    if (Math.abs(x - lx) + Math.abs(y - ly) > 0.2) {
      lx += (x - lx) * 0.28; ly += (y - ly) * 0.28;
      tag.style.transform = `translate3d(${lx.toFixed(1)}px,${ly.toFixed(1)}px,0)`;
    }
    const now = performance.now();
    if (state.scroll.velocity && lastTarget && now - lastCheck > 150) {
      lastCheck = now;
      const el = document.elementFromPoint(x, y);
      if (el && el !== lastTarget) setState(el);
    }
  });
}
