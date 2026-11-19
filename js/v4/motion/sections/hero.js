// Hero: entrance on ready (<= ~1.2 s) and the pinned scroll (state.heroPin 0..1 drives G's controller explode).
import { $, $$, claim, arm } from './util.js';
import { glitchTitle } from './glitch.js';

export function hero(ctx) {
  const { gsap, ScrollTrigger, tier, reduce } = ctx.motion;
  const { state } = ctx;
  const sec = document.getElementById('hero');
  state.heroPin = 0;
  if (!sec || reduce || tier === 0) return;

  const wm = $('.hero-matrix', sec), serif = $('.hero-serif', sec), card = $('.status-card', sec), meta = $('.hero-meta', sec);
  const word = $('.hero-word', sec), kicker = $('.hero-kicker', sec);
  const items = [serif, card, meta].filter(Boolean);
  items.forEach(claim);
  claim(wm);
  const sc = wm ? ctx.motion.scramble(wm) : null;
  const glitch = word && !/[?&]noglitch\b/.test(location.search) ? glitchTitle(ctx, word, sc) : null;
  gsap.set(items, { opacity: 0, y: 28 });
  items.forEach(arm);

  ctx.onReady(() => {
    const tl = gsap.timeline({ defaults: { ease: 'expo.out', duration: 0.72, clearProps: 'transform' } });
    if (sc) tl.add(() => sc.decode(55, 330).then(() => { glitch?.burst(1.4); glitch?.start(); }), 0);
    else glitch?.start();
    tl.to(serif, { opacity: 1, y: 0 }, 0.12)
      .to(card, { opacity: 1, y: 0 }, 0.28)
      .to(meta, { opacity: 1, y: 0 }, 0.44);
  });

  // pin + scrub: wordmark scales and drifts, copy fades while the controller explodes
  const end = tier === 2 ? '+=150%' : '+=80%';
  const tl = gsap.timeline({
    defaults: { ease: 'none' },
    scrollTrigger: {
      trigger: sec, start: 'top top', end, pin: true, pinSpacing: true, anticipatePin: 1, scrub: tier === 2 ? 0.5 : true,
      onUpdate: (self) => { state.heroPin = self.progress; glitch?.scroll(self.getVelocity()); },
      onLeave: () => { state.heroPin = 1; },
      onLeaveBack: () => { state.heroPin = 0; },
    },
  });
  if (word) tl.to(word, { scale: tier === 2 ? 1.1 : 1.05, yPercent: -7, duration: 1 }, 0);
  tl.to([serif, card, meta, kicker].filter(Boolean), { opacity: 0, duration: 0.45 }, 0.12);
}
