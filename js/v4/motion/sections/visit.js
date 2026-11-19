// Visit: subtle contour parallax; FAQ <details> with a smooth height animation (native open/closed semantics kept).
import { $, $$ } from './util.js';

export function visit(ctx) {
  const { gsap, tier, reduce } = ctx.motion;
  const sec = document.getElementById('visit');
  if (!sec || reduce) return;

  const cont = $('.contours', sec);
  if (cont && tier > 0) {
    gsap.fromTo(cont, { yPercent: -5 }, { yPercent: 5, ease: 'none', scrollTrigger: { trigger: sec, start: 'top bottom', end: 'bottom top', scrub: true } });
  }

  $$('.faq details', sec).forEach((d) => {
    const sum = $('summary', d);
    let tw = null;
    sum.addEventListener('click', (e) => {
      e.preventDefault();
      tw?.kill();
      d.style.overflow = 'hidden';
      const closed = sum.offsetHeight;
      if (!d.open) {
        d.open = true;
        const full = d.scrollHeight;
        tw = gsap.fromTo(d, { height: closed }, { height: full, duration: 0.5, ease: 'power3.out', onComplete: () => { d.style.height = ''; d.style.overflow = ''; } });
      } else {
        tw = gsap.to(d, { height: closed, duration: 0.38, ease: 'power3.inOut', onComplete: () => { d.open = false; d.style.height = ''; d.style.overflow = ''; } });
      }
    });
  });
}
