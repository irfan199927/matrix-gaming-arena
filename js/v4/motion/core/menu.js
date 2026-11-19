// Full-screen menu (owner M1): html.menu-open, everything outside the menu and header inert, focus in and back,
// Esc, scroll stopped, and on desktop a preview image that follows the hovered item. Open/close styling: base.css + motion.css.
export function initMenu(ctx, ui) {
  const { bus, root } = ctx;
  const btn = document.getElementById('menuBtn'), menu = document.getElementById('menu');
  if (!btn || !menu) return;
  const header = btn.closest('header') || btn;
  const label = btn.querySelector('.menu-btn-label');
  const preview = menu.querySelector('.menu-preview');
  const links = [...menu.querySelectorAll('.menu-link[data-img]')];
  const wide = matchMedia('(min-width: 1000px)');
  let open = false, restore = null, warmed = false;
  menu.inert = true;
  menu.querySelectorAll('.menu-item').forEach((li, i) => li.style.setProperty('--i', i));

  function set(o, focus = true) {
    if (o === open) return;
    open = o;
    root.classList.toggle('menu-open', o);
    btn.setAttribute('aria-expanded', String(o));
    if (label) label.textContent = o ? 'Close' : 'Menu';
    menu.inert = !o;
    if (o) {
      restore = ctx.inertExcept([menu, header]);
      ui.lenis?.stop();
      warm();
      if (focus) requestAnimationFrame(() => { if (open) menu.querySelector('.menu-link')?.focus({ preventScroll: true }); });
    } else {
      restore?.();
      restore = null;
      if (!root.classList.contains('gate-on')) ui.lenis?.start();
      if (focus) btn.focus({ preventScroll: true });
    }
    bus.emit('ui', { kind: o ? 'open' : 'close', el: menu });
  }
  ui.closeMenu = () => set(false, false);
  ui.menuOpen = () => open;

  btn.addEventListener('click', () => set(!open));
  addEventListener('keydown', (e) => { if (e.key === 'Escape' && open) { e.preventDefault(); set(false); } });
  menu.addEventListener('click', (e) => { if (e.target.closest?.('a[href^="#"]')) set(false, false); });

  /* ── preview (desktop): the hovered item's image, sliding toward the item ── */
  function warm() {
    if (warmed || !preview || !wide.matches) return;
    warmed = true;
    links.forEach((a) => { const im = new Image(); im.decoding = 'async'; im.src = a.dataset.img; });
    show(links[0], false);
  }
  let shown = null;
  function show(a, follow = true) {
    if (!preview || !a || !wide.matches) return;
    if (a !== shown) {
      shown = a;
      preview.style.backgroundImage = `url("${a.dataset.img}")`;
      preview.classList.remove('is-swap');
      requestAnimationFrame(() => preview.classList.add('is-swap'));
    }
    if (!follow) return;
    const r = a.getBoundingClientRect(), p = preview.getBoundingClientRect();
    const cur = parseFloat(preview.style.getPropertyValue('--mx-py')) || 0;
    const base = p.top - cur + p.height / 2; // the preview's resting centre
    const room = Math.max(0, (innerHeight - p.height) / 2 - 24);
    const dy = Math.max(-room, Math.min(room, (r.top + r.height / 2 - base) * 0.6));
    preview.style.setProperty('--mx-py', `${dy.toFixed(1)}px`);
  }
  links.forEach((a) => {
    a.addEventListener('pointerenter', () => show(a));
    a.addEventListener('focus', () => show(a));
  });
  return { set };
}
