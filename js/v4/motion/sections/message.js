// Message from the arena: pinned stage (tier 2), marquee nudge, photo clip reveal, racetrack drawn by scrub with a
// glowing head dot, and the manifesto revealed word by word.
import { $, $$, claim, arm } from './util.js';

export function message(ctx) {
  const m = ctx.motion, { gsap, ScrollTrigger, tier, reduce } = m;
  const sec = document.getElementById('message');
  if (!sec || reduce || tier === 0) return;
  const stage = $('.message-stage', sec);

  /* marquee rows: M1's helper moves them (speed rises with scroll velocity); a velocity skew adds the nudge */
  const rows = $$('[data-marquee]', sec);
  rows.forEach((row) => { claim(row); m.marquee(row, { boost: 34 }); });
  if (tier === 2 && rows.length) {
    const sk = rows.map((r) => gsap.quickTo(r, 'skewX', { duration: 0.5, ease: 'power3.out' }));
    gsap.ticker.add(() => {
      const v = ctx.state.scroll.velocity;
      if (!v && !rows[0]._sk) return;
      const k = Math.max(-5, Math.min(5, v * 0.16));
      rows[0]._sk = Math.abs(k) > 0.02;
      sk.forEach((q, i) => q(i ? -k : k));
    });
  }

  /* photo clip reveal + racetrack */
  const photo = $('.message-photo', sec), img = photo && $('img', photo), cap = photo && $('figcaption', photo);
  const path = $('[data-draw]', sec), svg = path?.closest('svg');
  claim(photo); claim(path);
  let L = 1, base = 5, head, glow;
  if (path && svg) {
    base = parseFloat(getComputedStyle(path).strokeWidth) || 5;
    path.style.vectorEffect = 'none';
    const ns = 'http://www.w3.org/2000/svg';
    glow = document.createElementNS(ns, 'circle'); head = document.createElementNS(ns, 'circle');
    glow.setAttribute('fill', '#38f24a'); head.setAttribute('fill', '#f2f4ee');
    glow.setAttribute('opacity', '0'); head.setAttribute('opacity', '0');
    glow.style.cssText = head.style.cssText = 'pointer-events:none';
    svg.append(glow, head);
  }
  const size = () => {
    if (!path) return;
    L = path.getTotalLength();
    const k = Math.min(svg.clientWidth / 1200, svg.clientHeight / 700) || 1;
    path.style.strokeWidth = `${base / k}px`;
    path.style.strokeDasharray = `${L}`;
    glow.setAttribute('r', 15 / k); head.setAttribute('r', 5.5 / k);
    setP(prog.p);
  };
  const prog = { p: 0 };
  function setP(p) {
    if (!path) return;
    path.style.strokeDashoffset = `${L * (1 - p)}`;
    const pt = path.getPointAtLength(L * p);
    for (const c of [glow, head]) { c.setAttribute('cx', pt.x); c.setAttribute('cy', pt.y); }
    const vis = p > 0.004 && p < 0.996;
    glow.setAttribute('opacity', vis ? '0.35' : '0'); head.setAttribute('opacity', vis ? '1' : '0');
  }
  if (path) { size(); ScrollTrigger.addEventListener('refreshInit', size); }

  if (photo && img) gsap.set(img, { clipPath: 'inset(100% 0% 0% 0%)', scale: 1.18 });
  if (cap) gsap.set(cap, { opacity: 0 });
  arm(photo);

  const pin = tier === 2;
  const tl = gsap.timeline({
    defaults: { ease: 'none' },
    scrollTrigger: pin
      ? { trigger: stage, start: 'center center', end: '+=100%', pin: true, pinSpacing: true, scrub: 0.6, anticipatePin: 1, invalidateOnRefresh: true }
      : { trigger: stage, start: 'top 75%', end: 'bottom 40%', scrub: 0.4 },
  });
  if (img) tl.to(img, { clipPath: 'inset(0% 0% 0% 0%)', scale: 1, duration: 0.3, ease: 'power2.out' }, 0);
  if (cap) tl.to(cap, { opacity: 1, duration: 0.1 }, 0.25);
  if (path) tl.to(prog, { p: 1, duration: 0.85, onUpdate: () => setP(prog.p) }, 0.12);

  /* manifesto: words dim -> full by scrub; accent words turn green */
  const man = $('.manifesto', sec);
  if (man) {
    claim(man);
    const words = m.split(man, 'words').words;
    // punctuation-led words stay glued to the word before (no line break before a comma)
    words.forEach((w) => { if (/^[,.;:!?)]/.test(w.textContent)) w.style.display = 'inline'; });
    const acc = words.filter((w) => w.closest('em'));
    gsap.set(words, { opacity: 0.13 });
    gsap.set(acc, { color: '#f2f4ee' });
    arm(man);
    const t2 = gsap.timeline({ defaults: { ease: 'none' }, scrollTrigger: { trigger: man, start: 'top 82%', end: 'bottom 55%', scrub: 0.35 } });
    words.forEach((w, i) => {
      t2.to(w, { opacity: 1, duration: 1 }, i * 0.55);
      if (acc.includes(w)) t2.to(w, { color: '#38f24a', duration: 1 }, i * 0.55 + 0.35);
    });
  }
}
