// SIM tachometer: RPM from smoothed |scroll velocity|, needle sweep, digits, gears with hysteresis, redline flash,
// speed, idle wobble. Publishes state.tach = {rpm, gear, speed} each frame while #sim is within ~1 viewport.
import { $, claim, clamp } from './util.js';

const TOPS = [70, 115, 165, 215, 265, 320]; // top speed per gear, km/h
const IDLE = 900;

export function tach(ctx) {
  const { gsap, ScrollTrigger, reduce } = ctx.motion;
  const { state } = ctx;
  const sec = document.getElementById('sim'), el = sec && $('[data-hud-tach]', sec);
  state.tach = null;
  if (!el || reduce) return;
  claim(el);
  const max = +el.dataset.rpmMax || 9000, a0 = +el.dataset.angleMin || -120, a1 = +el.dataset.angleMax || 120;
  const needle = $('.tach-needle', el), rpmEl = $('.tach-rpm', el), gearEl = $('.tach-gear', el), speedEl = $('.tach-speed', el);
  const s = { sv: 0, speed: 0, gear: 0, rpm: IDLE, sweep: 0, ang: NaN, r: -1, sp: -1, g: -1, red: false };
  let active = false;

  ScrollTrigger.create({
    trigger: sec, start: 'top bottom+=100%', end: 'bottom top-=100%',
    onToggle: (self) => { active = self.isActive; if (!active) state.tach = null; },
  });
  ScrollTrigger.create({
    trigger: sec, start: 'top 65%', once: true,
    onEnter: () => ctx.onReady(() => gsap.timeline()
      .to(s, { sweep: 1, duration: 0.6, ease: 'power2.in' })
      .to(s, { sweep: 0, duration: 0.9, ease: 'power3.out' })),
  });

  gsap.ticker.add((time, dtMs) => {
    if (!active) return;
    const dt = Math.min(dtMs, 64) / 16.67;
    const v = Math.abs(state.scroll.velocity) || 0;
    s.sv += (v - s.sv) * Math.min(1, 0.1 * dt);            // smoothed velocity, px/frame
    const throttle = clamp(s.sv / 34);
    const target = throttle * throttle * 0.4 + throttle * 0.6;
    s.speed += (target * TOPS[5] * 0.97 - s.speed) * Math.min(1, 0.06 * dt);
    let g = s.gear;
    if (s.speed < 3) g = 0;
    else {
      if (g === 0) g = 1;
      if (s.speed / TOPS[g - 1] > 0.92 && g < 6) g++;             // upshift
      else if (g > 1 && s.speed / TOPS[g - 2] < 0.72) g--;         // downshift, well below the upshift point (hysteresis)
    }
    s.gear = g;
    const ratio = g ? s.speed / TOPS[g - 1] : 0;
    let rpm = g ? 2200 + ratio * (max * 0.96 - 2200) : IDLE + s.sv * 40;
    rpm += Math.sin(time * 38) * 38 + Math.sin(time * 91) * 14; // idle / engine wobble
    rpm = Math.max(IDLE - 80, rpm);
    rpm = Math.max(rpm, IDLE + s.sweep * (max - IDLE));
    rpm = Math.min(max * 1.01, rpm);
    s.rpm = rpm;

    state.tach = { rpm, gear: g, speed: s.speed };

    const ang = a0 + clamp(rpm / max, 0, 1.01) * (a1 - a0);
    if (isNaN(s.ang) || Math.abs(ang - s.ang) > 0.08) { s.ang = ang; needle.style.transform = `rotate(${ang.toFixed(2)}deg)`; }
    const r = Math.round(rpm / 10) * 10, sp = Math.round(s.speed);
    if (r !== s.r) { s.r = r; rpmEl.textContent = String(r); }
    if (sp !== s.sp) { s.sp = sp; speedEl.textContent = String(sp).padStart(3, '0'); }
    if (g !== s.g) { s.g = g; gearEl.textContent = g ? String(g) : 'N'; }
    const red = rpm > max * 0.87;
    if (red !== s.red) { s.red = red; el.classList.toggle('is-redline', red); }
  });
}
