// THE MATRIX glitch: short RGB-split and slice-tear bursts on the hero wordmark. Three aria-hidden copies of the word sit
// inside .hero-word, so the pin's scale and drift apply to them too, and they only show during a burst (no idle cost).
// Triggers: one strong burst after the decode, a random one every 2.6-5 s (LEVEL) while the hero is on screen, the pointer
// crossing the word, and a fast scroll through the pin. Callers skip it for reduced motion and tier 0.
const rand = (a, b) => a + Math.random() * (b - a);
// strength the owner picked in the effects lab: "Wild". The others were Calm { 0.6, 10-16 s } and Default { 1, 7-12 s }
const LEVEL = { power: 1.7, every: [2600, 5000] };
const band = (min, max) => { const h = rand(min, max), top = rand(0, 100 - h); return `inset(${top.toFixed(1)}% 0 ${(100 - top - h).toFixed(1)}% 0)`; };

export function glitchTitle(ctx, word, sc) {
  const { state, bus } = ctx;
  const copy = word.cloneNode(true);
  copy.querySelectorAll('[data-scramble], [data-m2]').forEach((e) => { e.removeAttribute('data-scramble'); e.removeAttribute('data-m2'); });
  copy.querySelectorAll('.mx-ch').forEach((e) => e.replaceWith(e.textContent));
  // a, b: green and magenta split behind the word; tear: an ink copy on a paper band that hides and shifts a slice
  const [a, b, tear] = ['a', 'b', 'tear'].map((k) => {
    const l = document.createElement('span');
    l.className = `glitch-layer glitch-layer--${k}`;
    l.setAttribute('aria-hidden', 'true');
    l.innerHTML = copy.innerHTML;
    word.append(l);
    return l;
  });

  let busy = false, last = 0, idleT = 0, stepT = 0, onScreen = true;
  const reset = () => {
    for (const l of [a, b, tear]) { l.style.translate = ''; l.style.clipPath = ''; }
    word.style.translate = '';
    word.classList.remove('is-glitching');
    busy = false;
  };
  function burst(k = 1) { // k scales the picked strength
    const now = performance.now(), power = k * LEVEL.power;
    if (busy || document.hidden || now - last < 1200) return;
    busy = true; last = now;
    word.classList.add('is-glitching');
    sc?.glitch(power > 1.2 ? 2 : 1);
    bus.emit('ui', { kind: 'glitch', el: word });
    let n = Math.round(rand(6, 9) * power);
    const step = () => {
      if (n-- <= 0) return reset();
      const e = 0.018 + 0.03 * power; // offsets in em, so they scale with the wordmark
      const split = Math.random() < 0.6;
      a.style.translate = `${rand(-e, -e / 3).toFixed(3)}em ${rand(-e / 4, e / 4).toFixed(3)}em`;
      b.style.translate = `${rand(e / 3, e).toFixed(3)}em ${rand(-e / 4, e / 4).toFixed(3)}em`;
      a.style.clipPath = split ? '' : band(18, 60);
      b.style.clipPath = split ? '' : band(18, 60);
      const torn = Math.random() < 0.55;
      tear.style.clipPath = torn ? band(4, 16) : 'inset(50% 0 50% 0)';
      tear.style.translate = torn ? `${(rand(-2.4, 2.4) * e).toFixed(3)}em 0` : '';
      word.style.translate = Math.random() < 0.25 ? `${rand(-e / 2, e / 2).toFixed(3)}em 0` : '';
      stepT = setTimeout(step, rand(38, 72));
    };
    step();
  }

  const idle = () => {
    clearTimeout(idleT);
    idleT = setTimeout(() => { if (onScreen && (state.heroPin ?? 0) < 0.95) burst(rand(0.8, 1.1)); idle(); }, rand(...LEVEL.every));
  };
  new IntersectionObserver(([en]) => { onScreen = en.isIntersecting; }).observe(word);

  if (!state.touch) {
    let tp = 0;
    addEventListener('pointermove', (e) => {
      if (!onScreen || e.timeStamp - tp < 90) return;
      tp = e.timeStamp;
      const r = word.getBoundingClientRect();
      if (e.clientX > r.left && e.clientX < r.right && e.clientY > r.top && e.clientY < r.bottom) burst(0.9);
    }, { passive: true });
  }

  return {
    burst,
    start() { idle(); },
    scroll(v) { if (Math.abs(v) > 2600) burst(0.8); }, // px/s from the hero pin's ScrollTrigger
    stop() { clearTimeout(idleT); clearTimeout(stepT); reset(); },
  };
}
