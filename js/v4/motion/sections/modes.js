// Modes: staggered entrance, hover/focus expand-and-shrink (state classes + ui hover), stacked tap feedback on touch.
import { $, $$, claim, arm, emit } from './util.js';

export function modes(ctx) {
  const { gsap, ScrollTrigger, tier, reduce } = ctx.motion;
  const list = document.querySelector('#modes .mode-list');
  if (!list) return;
  const items = $$('.mode-item', list);

  if (!reduce && tier > 0) {
    items.forEach(claim);
    gsap.set(items, { opacity: 0, y: 70 });
    items.forEach(arm);
    ScrollTrigger.create({
      trigger: list, start: 'top 82%', once: true,
      onEnter: () => ctx.onReady(() => gsap.to(items, { opacity: 1, y: 0, duration: 1.1, ease: 'expo.out', stagger: 0.14, clearProps: 'transform,opacity' })),
    });
  }

  const set = (it, on, a) => {
    list.classList.toggle('has-active', on);
    items.forEach((x) => x.classList.toggle('is-active', on && x === it));
    if (on) emit(ctx, 'hover', a);
  };
  items.forEach((it) => {
    const a = $('.mode', it);
    a.addEventListener('pointerenter', (e) => { if (e.pointerType === 'mouse') set(it, true, a); });
    a.addEventListener('pointerleave', (e) => { if (e.pointerType === 'mouse') set(it, false, a); });
    a.addEventListener('focus', () => set(it, true, a));
    a.addEventListener('blur', () => set(it, false, a));
    // touch: the pressed card dips, its siblings recede a little (stacked feedback)
    a.addEventListener('pointerdown', (e) => {
      if (e.pointerType === 'mouse') return;
      list.classList.add('has-press'); it.classList.add('is-press');
      emit(ctx, 'hover', a);
    });
    const up = (e) => {
      if (e.type === 'pointerleave' && e.pointerType === 'mouse') return;
      setTimeout(() => { it.classList.remove('is-press'); list.classList.remove('has-press'); }, 160);
    };
    a.addEventListener('pointerup', up); a.addEventListener('pointercancel', up); a.addEventListener('pointerleave', up);
  });
}
