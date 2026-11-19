// CONTINUE?: counts [data-countdown] 9 -> 0 when in view (ui 'countdown' each second), then ui 'go', a CTA pulse and a
// playful line. Restarts when you come back. Reduced motion: static.
import { $, claim } from './util.js';

export function cont(ctx) {
  const { ScrollTrigger, reduce } = ctx.motion;
  const num = document.querySelector('[data-countdown]');
  if (!num || reduce) return;
  claim(num);
  const foot = document.getElementById('continue');
  const cta = foot && $('.continue-cta', foot);
  const line = document.createElement('p');
  line.className = 'continue-go';
  line.setAttribute('aria-live', 'polite');
  num.closest('.countdown')?.after(line);

  let timer = 0, n = 9, runId = 0;
  const reset = () => {
    clearTimeout(timer); runId++;
    n = 9; num.textContent = '9';
    line.textContent = ''; line.classList.remove('is-on');
    cta?.classList.remove('is-go');
    num.classList.remove('is-zero');
  };
  const start = () => {
    reset();
    const id = runId;
    const step = () => {
      if (id !== runId) return;
      if (n > 0) {
        timer = setTimeout(() => {
          if (id !== runId) return;
          n--; num.textContent = String(n);
          ctx.bus.emit('ui', { kind: 'countdown', el: num });
          step();
        }, 1000);
      } else {
        num.classList.add('is-zero');
        ctx.bus.emit('ui', { kind: 'go', el: cta || num });
        line.textContent = 'Game on.';
        line.classList.add('is-on');
        cta?.classList.add('is-go');
      }
    };
    step();
  };
  ScrollTrigger.create({
    trigger: num, start: 'top 85%', end: 'bottom 10%',
    onEnter: start, onEnterBack: start, onLeave: reset, onLeaveBack: reset,
  });
}
