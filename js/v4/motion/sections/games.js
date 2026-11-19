// Games: tile depth parallax, caption + media reveals (colour and lift on hover/focus live in CSS).
import { $, $$, claim, arm } from './util.js';

export function games(ctx) {
  const { gsap, ScrollTrigger, tier, reduce } = ctx.motion;
  if (reduce || tier === 0) return;
  const phone = innerWidth < 760;
  $$('#games .tile[data-parallax]').forEach((tile) => {
    claim(tile);
    let f = parseFloat(tile.dataset.parallax) || 0.1;
    if (tier === 1) f *= 0.5;
    if (!phone) {
      const d = () => f * (innerHeight + tile.offsetHeight) / 2;
      gsap.fromTo(tile, { y: () => -d() }, {
        y: () => d(), ease: 'none',
        scrollTrigger: { trigger: tile, start: 'top bottom', end: 'bottom top', scrub: true, invalidateOnRefresh: true },
      });
    }
    const cap = $('.tile-cap', tile), media = $('.tile-media', tile);
    if (cap) gsap.set(cap, { opacity: 0, y: 14 });
    if (media) gsap.set(media, { clipPath: 'inset(0% 0% 100% 0%)' });
    arm(tile);
    ScrollTrigger.create({
      trigger: tile, start: 'top 88%', once: true,
      onEnter: () => ctx.onReady(() => {
        if (media) gsap.to(media, { clipPath: 'inset(0% 0% 0% 0%)', duration: 1.1, ease: 'expo.inOut', clearProps: 'clipPath' });
        if (cap) gsap.to(cap, { opacity: 1, y: 0, duration: 0.8, ease: 'expo.out', delay: 0.35, clearProps: 'transform' });
      }),
    });
  });
}
