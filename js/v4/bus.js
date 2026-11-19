// Shared event bus and per-frame state for the V4 modules (motion, gl, audio).
// Contract: redesign-docs/v4/00-spec.md §6. Events are for moments; `state` is polled every frame.
const handlers = new Map();

export const bus = {
  on(type, fn) {
    if (!handlers.has(type)) handlers.set(type, new Set());
    handlers.get(type).add(fn);
    return () => bus.off(type, fn);
  },
  off(type, fn) { handlers.get(type)?.delete(fn); },
  emit(type, detail) {
    handlers.get(type)?.forEach((fn) => {
      try { fn(detail); } catch (e) { console.error(`[bus] ${type} handler failed`, e); }
    });
  },
};

const root = document.documentElement;

export const state = {
  tier: Number(root.dataset.tier ?? 0),
  reduce: matchMedia('(prefers-reduced-motion: reduce)').matches,
  touch: matchMedia('(hover: none), (pointer: coarse)').matches,
  scroll: { y: 0, progress: 0, velocity: 0 },  // velocity in px/frame, signed; written by motion every frame
  pointer: { x: 0, y: 0, nx: 0, ny: 0 },       // nx/ny in -1..1 from the viewport centre
  chapter: null,                                // { id, theme, mood, scene, el } of the chapter at the viewport centre
  sound: false,
};
