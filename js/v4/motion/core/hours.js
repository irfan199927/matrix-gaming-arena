// Live opening hours (owner M1), same rules as the draft: IST, open 11:00, close [24,23,23,23,23,24,24] Sun..Sat.
export const HOURS = { open: 11, close: [24, 23, 23, 23, 23, 24, 24] };
const fmt = (h) => (h === 24 ? 'midnight' : `${h > 12 ? h - 12 : h} ${h >= 12 ? 'PM' : 'AM'}`);

// Pure: status at a moment (ms since epoch). India has no DST, so IST is UTC+5:30 all year.
export function hoursAt(ms = Date.now()) {
  const t = new Date(ms + 330 * 60000);
  const day = t.getUTCDay(), hr = t.getUTCHours() + t.getUTCMinutes() / 60, closeAt = HOURS.close[day];
  const open = hr >= HOURS.open && hr < closeAt;
  const text = open ? `Open now · till ${fmt(closeAt)}`
    : hr < HOURS.open ? `Closed · opens ${fmt(HOURS.open)} today`
      : `Closed · opens ${fmt(HOURS.open)} tomorrow`;
  return { open, text, day, today: `${fmt(HOURS.open)} – ${fmt(closeAt)}`, year: t.getUTCFullYear() };
}

export function initHours() {
  const update = () => {
    const h = hoursAt();
    document.querySelectorAll('[data-status]').forEach((el) => el.classList.toggle('is-open', h.open));
    document.querySelectorAll('[data-status-text]').forEach((el) => { if (el.textContent !== h.text) el.textContent = h.text; });
    document.querySelectorAll('[data-hours-today]').forEach((el) => { el.textContent = h.today; });
    document.querySelectorAll('[data-hours-row], [data-days]').forEach((el) => {
      const on = (el.dataset.hoursRow ?? el.dataset.days ?? '').split(',').includes(String(h.day));
      el.classList.toggle('today', on);
      if (on) el.setAttribute('aria-current', 'date'); else el.removeAttribute('aria-current');
    });
    const yr = document.getElementById('yr');
    if (yr) yr.textContent = h.year;
  };
  update();
  setInterval(update, 60000); // keeps "open now" right for tabs left open across opening or closing time
  return update;
}
