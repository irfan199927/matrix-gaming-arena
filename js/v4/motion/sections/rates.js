// Rates: on bus 'rates:tab' the rows cascade like a timing board, numbers roll, ui 'tick' per row.
import { $$ } from './util.js';

export function rates(ctx) {
  const { gsap, ScrollTrigger, reduce } = ctx.motion;
  if (reduce) return;
  const live = new Map(); // panel -> {tw, timers, cells}
  const stop = (panel) => {
    const l = live.get(panel);
    if (!l) return;
    l.tw.forEach((t) => t.kill());
    l.timers.forEach(clearTimeout);
    l.cells.forEach(([c, t]) => { c.textContent = t; });
    live.delete(panel);
  };
  const cascade = (panel) => {
    if (!panel) return;
    stop(panel);
    const rows = $$('tbody tr', panel), l = { tw: [], timers: [], cells: [] };
    live.set(panel, l);
    gsap.set(rows, { opacity: 0, y: 16 });
    rows.forEach((row, i) => {
      const delay = 0.05 + i * 0.075;
      l.tw.push(gsap.to(row, { opacity: 1, y: 0, duration: 0.55, ease: 'expo.out', delay, clearProps: 'transform' }));
      l.timers.push(setTimeout(() => ctx.bus.emit('ui', { kind: 'tick', el: row }), delay * 1000));
      $$('td', row).forEach((td) => {
        const txt = td.textContent, n = parseFloat(txt.replace(/[^\d.]/g, ''));
        if (!isFinite(n) || !/\d/.test(txt)) return;
        l.cells.push([td, txt]);
        const o = { v: n * 0.3 };
        const put = () => { td.textContent = txt.replace(/[\d.,]+/, String(Math.round(o.v))); };
        put();
        l.tw.push(gsap.to(o, { v: n, duration: 0.7, ease: 'power3.out', delay: delay + 0.05, onUpdate: put, onComplete: () => { td.textContent = txt; } }));
      });
    });
  };
  ctx.bus.on('rates:tab', (d) => cascade(d?.panel));
  const sheet = document.querySelector('#rates .sheet');
  const current = () => document.querySelector('#rates .panel:not([hidden])') || document.querySelector('#rates .panel');
  if (sheet) ScrollTrigger.create({ trigger: sheet, start: 'top 72%', once: true, onEnter: () => ctx.onReady(() => cascade(current())) });
}
