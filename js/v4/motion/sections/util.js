// Shared helpers for the chapter choreography (owner M2).
export const $ = (s, el = document) => el.querySelector(s);
export const $$ = (s, el = document) => [...el.querySelectorAll(s)];
// claim an element: M1's generic pass skips anything with [data-m2]; mx-armed lifts its CSS pre-state
export const claim = (el) => { el?.setAttribute('data-m2', ''); return el; };
export const arm = (el) => el?.classList.add('mx-armed');
export const clamp = (v, a = 0, b = 1) => Math.min(b, Math.max(a, v));
export const emit = (ctx, kind, el) => ctx.bus.emit('ui', { kind, el });
