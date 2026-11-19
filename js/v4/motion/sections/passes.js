// Passes: season-pass track. Desktop tier 2 pins the PS5 track for a run with an XP-style progress line; tiers below
// get the same line as a plain scrub (vertical fill on phones). Tier markers light up as the line reaches them,
// "Best value" pulses once when it lights.
import { $, $$, claim, arm, clamp } from './util.js';

export function passes(ctx) {
  const { gsap, ScrollTrigger, tier, reduce } = ctx.motion;
  const sec = document.getElementById('passes');
  if (!sec || reduce || tier === 0) return;
  const wide = matchMedia('(min-width: 900px)').matches;

  $$('.pass[data-reveal]', sec).forEach((p) => {
    claim(p);
    gsap.set(p, { opacity: 0, y: 44 });
    arm(p);
    ScrollTrigger.create({
      trigger: p, start: 'top 90%', once: true,
      onEnter: () => ctx.onReady(() => gsap.to(p, { opacity: 1, y: 0, duration: 1, ease: 'expo.out', clearProps: 'transform,opacity', delay: wide ? ((+p.dataset.i || 0) * 0.08) : 0 })),
    });
  });

  $$('.pass-track', sec).forEach((tr) => {
    const track = $('.track', tr), cards = $$('.pass', tr);
    if (!track || !cards.length) return;
    cards.forEach((c, i) => { c.dataset.i = i; });
    const xp = document.createElement('span');
    xp.className = 'label track-xp'; xp.setAttribute('aria-hidden', 'true'); xp.textContent = 'XP 0%';
    $('.track-title', tr)?.append(xp);
    let thr = [];
    const measure = () => {
      if (wide) {
        const w = track.offsetWidth * (tr.classList.contains('pass-track--race') ? 0.5 : 1) || 1;
        thr = cards.map((c, i) => (i ? clamp((c.offsetLeft + 7) / w, 0.05, 0.97) : 0.02));
      } else {
        const h = Math.max(1, track.offsetHeight - 16);
        thr = cards.map((c, i) => (i ? clamp((c.offsetTop + 2) / h, 0.05, 0.97) : 0.02));
      }
    };
    let pulsed = false, last = -1;
    const apply = (p) => {
      track.style.setProperty('--xp', p.toFixed(4));
      const pct = Math.round(p * 100);
      if (pct !== last) { last = pct; xp.textContent = `XP ${pct}%`; }
      cards.forEach((c, i) => {
        const on = p >= thr[i];
        if (on !== c.classList.contains('is-lit')) {
          c.classList.toggle('is-lit', on);
          if (on) ctx.bus.emit('ui', { kind: 'tick', el: c });
          if (on && c.classList.contains('pass--best') && !pulsed) { pulsed = true; c.classList.add('is-pulse'); }
        }
      });
    };
    ScrollTrigger.addEventListener('refreshInit', measure);
    measure();
    apply(0);
    const pinned = tier === 2 && wide && tr.classList.contains('pass-track--ps5');
    ScrollTrigger.create({
      trigger: tr,
      start: pinned ? 'top 14%' : wide ? 'top 70%' : 'top 60%',
      end: pinned ? '+=100%' : wide ? 'bottom 55%' : 'bottom 62%',
      pin: pinned, pinSpacing: pinned, scrub: pinned ? 0.5 : 0.3, anticipatePin: pinned ? 1 : 0,
      invalidateOnRefresh: true,
      onUpdate: (self) => apply(self.progress),
    });
  });
}
