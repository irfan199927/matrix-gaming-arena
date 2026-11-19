// Reviews: mouse/pen drag with inertia on the native overflow track, arrow keys. Touch keeps native scrolling, so
// vertical swipes pass through untouched (and horizontal ones use the browser's own momentum + snap).
import { $, $$ } from './util.js';

export function reviews(ctx) {
  const { gsap, ScrollTrigger, tier, reduce } = ctx.motion;
  const track = document.querySelector('#reviews .reviews-track');
  if (!track) return;
  const cards = $$('.review', track);

  if (!reduce && tier > 0 && cards.length) {
    gsap.set(cards, { opacity: 0, y: 36 });
    ScrollTrigger.create({
      trigger: track, start: 'top 92%', once: true,
      onEnter: () => ctx.onReady(() => gsap.to(cards, { opacity: 1, y: 0, duration: 0.9, ease: 'expo.out', stagger: 0.1, clearProps: 'transform,opacity' })),
    });
  }

  let drag = null, vel = 0, raf = 0, moved = 0;
  const stopInertia = () => { cancelAnimationFrame(raf); raf = 0; };
  const inertia = () => {
    track.scrollLeft -= vel;
    vel *= 0.94;
    if (Math.abs(vel) > 0.4 && track.scrollLeft > 0 && track.scrollLeft < track.scrollWidth - track.clientWidth) raf = requestAnimationFrame(inertia);
    else { raf = 0; track.classList.remove('is-drag'); }
  };
  track.addEventListener('pointerdown', (e) => {
    if (e.pointerType === 'touch' || e.button !== 0) return;
    stopInertia();
    drag = { x: e.clientX, left: track.scrollLeft, last: e.clientX, t: performance.now(), id: e.pointerId };
    moved = 0; vel = 0;
  });
  track.addEventListener('pointermove', (e) => {
    if (!drag || e.pointerId !== drag.id) return;
    const dx = e.clientX - drag.x;
    if (!moved && Math.abs(dx) < 4) return;
    if (!moved) { moved = 1; track.classList.add('is-drag'); try { track.setPointerCapture(e.pointerId); } catch (err) { /* ignore */ } }
    track.scrollLeft = drag.left - dx;
    const now = performance.now(), dt = Math.max(8, now - drag.t);
    vel = vel * 0.6 + ((e.clientX - drag.last) * (16 / dt)) * 0.4;
    drag.last = e.clientX; drag.t = now;
  });
  const end = (e) => {
    if (!drag || (e && e.pointerId !== drag.id)) return;
    drag = null;
    if (moved && !reduce && Math.abs(vel) > 1) raf = requestAnimationFrame(inertia);
    else track.classList.remove('is-drag');
  };
  track.addEventListener('pointerup', end); track.addEventListener('pointercancel', end);
  track.addEventListener('lostpointercapture', end);
  track.addEventListener('dragstart', (e) => e.preventDefault());
  track.addEventListener('wheel', stopInertia, { passive: true });

  track.addEventListener('keydown', (e) => {
    if (e.key !== 'ArrowRight' && e.key !== 'ArrowLeft') return;
    e.preventDefault();
    stopInertia();
    const step = (cards[0]?.offsetWidth || track.clientWidth * 0.8) + 24;
    track.scrollBy({ left: e.key === 'ArrowRight' ? step : -step, behavior: reduce ? 'auto' : 'smooth' });
  });
}
