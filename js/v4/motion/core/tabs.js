// Rates tabs (owner M1). All panels ship visible in the HTML (readable without JS); JS reveals the tablist and
// applies the ARIA tabs pattern: roving tabindex, Arrow Left/Right (wrapping), Home/End, static panels.
// Emits `rates:tab` {k, panel} on every change (M2 animates the rows from it).
export function initTabs(bus) {
  document.querySelectorAll('[role="tablist"]').forEach((list) => {
    const tabs = [...list.querySelectorAll('[role="tab"]')];
    const panels = tabs.map((t) => document.getElementById(t.getAttribute('aria-controls')));
    if (!tabs.length || panels.some((p) => !p)) return;
    const keyOf = (t) => t.dataset.k || t.id.replace(/^tab-/, '');
    let cur = -1;
    const select = (i, focus) => {
      tabs.forEach((t, j) => {
        t.setAttribute('aria-selected', String(j === i));
        t.tabIndex = j === i ? 0 : -1;
      });
      panels.forEach((p, j) => { p.hidden = j !== i; });
      if (focus) tabs[i].focus();
      if (i !== cur) { cur = i; bus?.emit('rates:tab', { k: keyOf(tabs[i]), panel: panels[i] }); }
    };
    tabs.forEach((t, i) => {
      t.addEventListener('click', () => select(i));
      t.addEventListener('keydown', (e) => {
        const n = tabs.length;
        const j = e.key === 'ArrowRight' ? (i + 1) % n : e.key === 'ArrowLeft' ? (i - 1 + n) % n
          : e.key === 'Home' ? 0 : e.key === 'End' ? n - 1 : -1;
        if (j < 0) return;
        e.preventDefault();
        select(j, true);
      });
    });
    // "See PS5 rates" style links elsewhere on the page pick their tab (the link itself scrolls to #rates)
    document.querySelectorAll('[data-tab]').forEach((a) => a.addEventListener('click', () => {
      const i = tabs.findIndex((t) => keyOf(t) === a.dataset.tab);
      if (i >= 0) select(i);
    }));
    list.hidden = false;
    select(Math.max(0, tabs.findIndex((t) => t.getAttribute('aria-selected') === 'true')));
  });
}
