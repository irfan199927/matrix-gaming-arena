// Section choreography entry (owner M2). M1 calls init(ctx) after setting ctx.motion. Each chapter module is isolated:
// one throwing never stops the others. Everything registers through ctx.motion (no Lenis or ticker of our own).
import { hero } from './hero.js';
import { message } from './message.js';
import { modes } from './modes.js';
import { chapters } from './chapters.js';
import { tach } from './tach.js';
import { games } from './games.js';
import { rates } from './rates.js';
import { passes } from './passes.js';
import { reviews } from './reviews.js';
import { visit } from './visit.js';
import { cont } from './continue.js';

// order matters: pins are created in document order (hero, message, passes)
const MODULES = { hero, message, modes, chapters, tach, games, rates, passes, reviews, visit, continue: cont };

export function init(ctx) {
  const m = ctx.motion;
  if (!m) return null;
  const { gsap, ScrollTrigger } = m;
  const gctx = gsap.context(() => {
    const off = (new URLSearchParams(location.search).get('m2off') || '').split(','); // QA: ?m2off=games,tach
    for (const [name, fn] of Object.entries(MODULES)) {
      if (off.includes(name)) continue;
      try { fn(ctx); } catch (e) { console.error(`[v4] sections/${name} failed`, e); }
    }
  });
  // layout shifts after fonts and lazy images: re-measure the pins and scrubs
  let t = 0;
  const refresh = () => { clearTimeout(t); t = setTimeout(() => ScrollTrigger.refresh(), 120); };
  document.fonts?.ready.then(refresh);
  if (document.readyState !== 'complete') addEventListener('load', refresh, { once: true });
  return { destroy: () => gctx.revert() };
}
