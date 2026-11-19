// PS5 / SIM / VR chapters: split-title reveals, specs stagger, price counters.
import { $$, claim } from './util.js';

export function chapters(ctx) {
  const m = ctx.motion, { gsap, ScrollTrigger, tier, reduce } = m;
  if (reduce || tier === 0) return;
  for (const id of ['ps5', 'sim', 'vr']) {
    const sec = document.getElementById(id);
    if (!sec) continue;
    $$('.chapter-title [data-split]', sec).forEach((el) => {
      claim(el);
      m.splitReveal(el, el.dataset.split);
    });
    $$('.chips', sec).forEach((ul) => {
      const li = [...ul.children];
      gsap.set(li, { opacity: 0, y: 18 });
      ScrollTrigger.create({
        trigger: ul, start: 'top 90%', once: true,
        onEnter: () => ctx.onReady(() => gsap.to(li, { opacity: 1, y: 0, duration: 0.7, ease: 'expo.out', stagger: 0.09, clearProps: 'transform' })),
      });
    });
    $$('.price b', sec).forEach((b) => m.count(b, { duration: 1.2 }));
  }
}
