// Motion core entry (owner M1). init(ctx, boot) brings up, in order:
//   1. GSAP-free features: live hours, rates tabs, the frame loop (state, chapters, theme, header, dock, anchors), menu
//   2. GSAP + ScrollTrigger + SplitText (+ Lenis on tier 2 with a fine pointer), then ctx.motion
//   3. the chapter choreography (sections/index.js, M2), then the generic data-* pass on what M2 did not claim
// Each feature is isolated, so one failing never takes the others (or the page) down.
//
// ctx.motion (set before sections.init(ctx)): { gsap, ScrollTrigger, SplitText, lenis|null, tier, reduce, fine, onReady(fn),
//   scrollTo(target,{offset,immediate}), setTheme(from,to,t), refresh(),
//   split(el,type) -> SplitText, splitReveal(el,type,{delay,start}), reveal(el,'up|fade|clip',opts), parallax(el,f),
//   marquee(el,{dir,speed,boost}) -> handle, scramble(el) -> handle {decode()} (MATRIX decode), count(el,opts), draw(el,opts) }
// Bus: 'rates:tab' {k,panel}, 'chapter', 'ui'. ctx.onReady(fn) runs fn after 'ready' (even if already fired).
import { initHours } from './core/hours.js';
import { initTabs } from './core/tabs.js';
import { initScroll } from './core/scroll.js';
import { initMenu } from './core/menu.js';
import { initPointer } from './core/pointer.js';
import { initFx } from './core/fx.js';

export async function init(ctx, boot = {}) {
  const { state, root, bus } = ctx;
  const reduce = state.reduce, tier = state.tier;
  const safe = (name, fn) => { try { return fn(); } catch (e) { console.error(`[v4] motion: ${name} failed`, e); return null; } };
  const ui = {}; // shared between the core modules: lenis, ScrollTrigger, closeMenu()
  const sections = import('./sections/index.js').catch((e) => { console.warn('[v4] sections unavailable:', e?.message || e); return null; });

  safe('hours', initHours);
  safe('tabs', () => initTabs(bus));
  const scroll = safe('scroll', () => initScroll(ctx, ui));
  safe('menu', () => initMenu(ctx, ui));

  const { gsap, ScrollTrigger, SplitText, Lenis } = await boot.libs;
  gsap.registerPlugin(ScrollTrigger, SplitText);
  ScrollTrigger.config({ ignoreMobileResize: true });
  const lenis = (scroll && safe('lenis', () => scroll.attach(gsap, ScrollTrigger, reduce ? null : Lenis))) || null;
  const fx = initFx(ctx, { gsap, ScrollTrigger, SplitText });

  const motion = ctx.motion = {
    gsap, ScrollTrigger, SplitText, lenis, tier, reduce, fine: !!boot.fine,
    onReady: ctx.onReady,
    scrollTo: (target, opts) => scroll?.scrollTo(target, opts),
    setTheme: (from, to, t) => scroll?.setTheme(from, to, t),
    refresh: () => ScrollTrigger.refresh(),
    ...fx.api,
  };
  safe('pointer', () => initPointer(ctx, motion));

  // chapter choreography first, so it can claim elements ([data-m2]) before the generic pass
  const m2 = await sections;
  if (m2?.init) {
    try { await Promise.race([m2.init(ctx), new Promise((r) => setTimeout(r, 1500))]); } catch (e) { console.error('[v4] sections init failed', e); }
  }
  try { boot.sectionsDone?.(); } catch (e) { /* ignore */ }
  try {
    fx.auto((e, el) => console.error('[v4] motion helper failed on', el, e));
  } catch (e) {
    console.error('[v4] motion: generic pass failed', e);
    root.classList.add('motion-fail');
  }
  if (!reduce) root.classList.add('motion-on');
  ScrollTrigger.refresh();
  bus.emit('motion:ready', { lenis: !!lenis });
  return motion;
}
