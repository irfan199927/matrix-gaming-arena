// UI sound effects, the title-start sting and the mode-card motifs (agent A). All synthesized, short, quiet and original.
export function makeSfx({ gain, filt, osc, pan, chain, done, nsrc, rnd, mtof, out, verb }) {
  const send = (from, amt, nodes) => { if (amt) { const s = gain(amt); from.connect(s); s.connect(verb); nodes.push(s); } };

  // enveloped tone: attack a, hold, release (time-constant r/3); optional glide to f1 over gl, lowpass, pan, reverb
  function tone(t, f, { type = 'sine', vol = 0.03, a = 0.003, hold = 0, r = 0.05, f1 = 0, gl = 0, lp = 0, p = 0, rev = 0 } = {}) {
    const o = osc(type, f), g = gain(0), pn = pan(p), nodes = [o, g, pn], rel = t + a + hold;
    let x = o; if (lp) { x = filt('lowpass', lp, 0.7); o.connect(x); nodes.push(x); }
    chain(x, g, pn, out); send(pn, rev, nodes);
    if (f1) { o.frequency.setValueAtTime(f, t); o.frequency.exponentialRampToValueAtTime(f1, t + (gl || a + hold + r)); }
    g.gain.setValueAtTime(0, t); g.gain.linearRampToValueAtTime(vol, t + a); g.gain.setValueAtTime(vol, rel); g.gain.setTargetAtTime(0, rel, r / 3);
    o.start(t); o.stop(rel + r * 4); done(o, nodes);
  }
  // filtered noise: a hit (fast attack, decay d/3) or a swell (rise and fall over d), optional filter and pan sweeps
  function nz(t, d, { type = 'bandpass', f0 = 1000, f1 = 0, Q = 1, vol = 0.03, swell = false, p0 = 0, p1 = null, rev = 0 } = {}) {
    const s = nsrc(), f = filt(type, f0, Q), g = gain(0), pn = pan(p0), nodes = [s, f, g, pn];
    chain(s, f, g, pn, out); send(pn, rev, nodes);
    if (f1) { f.frequency.setValueAtTime(f0, t); f.frequency.exponentialRampToValueAtTime(f1, t + d); }
    if (p1 != null) { pn.pan.setValueAtTime(p0, t); pn.pan.linearRampToValueAtTime(p1, t + d); }
    g.gain.setValueAtTime(0, t);
    if (swell) { g.gain.linearRampToValueAtTime(vol, t + d * 0.55); g.gain.linearRampToValueAtTime(0, t + d); }
    else { g.gain.linearRampToValueAtTime(vol, t + 0.001); g.gain.setTargetAtTime(0, t + 0.001, d / 3); }
    s.start(t, rnd() * 1.5); s.stop(t + (swell ? d : d * 4) + 0.01); done(s, nodes);
  }
  // pluck: saw through a closing lowpass
  function pl(t, m, vol, d = 0.25, p = 0, rev = 0.25) {
    const f0 = mtof(m), o = osc('sawtooth', f0), f = filt('lowpass', 1, 1.5), g = gain(0), pn = pan(p), nodes = [o, f, g, pn];
    chain(o, f, g, pn, out); send(pn, rev, nodes);
    f.frequency.setValueAtTime(Math.min(6000, f0 * 5), t); f.frequency.setTargetAtTime(f0 * 1.2, t, d / 3);
    g.gain.setValueAtTime(0, t); g.gain.linearRampToValueAtTime(vol, t + 0.003); g.gain.setTargetAtTime(0, t + 0.003, d / 3);
    o.start(t); o.stop(t + d * 3); done(o, nodes);
  }
  // small FM bell
  function bell(t, f, vol) {
    const c = osc('sine', f), m = osc('sine', f * 3.5), mg = gain(0), g = gain(0), nodes = [c, m, mg, g];
    chain(m, mg, c.frequency); chain(c, g, out); send(g, 0.4, nodes);
    mg.gain.setValueAtTime(f * 0.8, t); mg.gain.setTargetAtTime(0, t, 0.1);
    g.gain.setValueAtTime(0, t); g.gain.linearRampToValueAtTime(vol, t + 0.004); g.gain.setTargetAtTime(0, t + 0.004, 0.22);
    for (const x of [c, m]) { x.start(t); x.stop(t + 1.6); }
    done(c, nodes);
  }

  const K = {
    hover: (t) => tone(t, 2200 * (0.96 + rnd() * 0.08), { vol: 0.026, a: 0.002, r: 0.014 }),
    click: (t) => { tone(t, mtof(85), { type: 'triangle', vol: 0.045, r: 0.035, lp: 3800 }); tone(t + 0.055, mtof(90), { type: 'triangle', vol: 0.04, r: 0.05, lp: 3800 }); },
    open: (t) => nz(t, 0.42, { f0: 380, f1: 2800, Q: 1.4, vol: 0.075, swell: true, p0: -0.5, p1: 0.5, rev: 0.25 }),
    close: (t) => nz(t, 0.36, { f0: 2600, f1: 360, Q: 1.4, vol: 0.07, swell: true, p0: 0.5, p1: -0.5, rev: 0.25 }),
    tick: (t) => { nz(t, 0.006, { f0: 2400, Q: 3, vol: 0.05 }); tone(t, 620, { vol: 0.012, a: 0.001, r: 0.012 }); },
    countdown: (t) => tone(t, 880, { type: 'square', vol: 0.03, a: 0.002, hold: 0.075, r: 0.02, lp: 2400 }),
    go: (t) => [81, 85, 88, 93].forEach((m, i) => bell(t + i * 0.06, mtof(m), 0.022)), // A major arpeggio
    glitch: (t) => { // THE MATRIX glitch: a few band-passed noise ticks scattered across the stereo field, and a low buzz
      for (let i = 0; i < 4; i++) nz(t + i * 0.04 + rnd() * 0.015, 0.012, { f0: 700 + rnd() * 4800, Q: 6, vol: 0.03, p0: rnd() * 1.6 - 0.8 });
      tone(t, 110, { type: 'square', vol: 0.01, a: 0.001, hold: 0.07, r: 0.02, lp: 900 });
    },
  };

  function sting(t) { // title start: soft thump, rising F# minor pluck figure, F#m(add9) bloom, a little air
    tone(t, 92, { vol: 0.12, a: 0.004, r: 0.3, f1: 40, gl: 0.14 });
    [66, 69, 73, 78].forEach((m, i) => pl(t + 0.05 + i * 0.085, m, 0.04 - i * 0.004, 0.22, (i - 1.5) * 0.3, 0.3));
    [66, 69, 73, 80].forEach((m) => pl(t + 0.42, m, 0.022, 0.9, 0, 0.6));
    nz(t + 0.25, 0.6, { f0: 4500, Q: 0.8, vol: 0.012, swell: true, rev: 0.5 });
  }
  function motif(mood, t) { // mode-card hover
    if (mood === 'ps5') [73, 76, 81, 85, 88].forEach((m, i) => pl(t + i * 0.07, m, 0.026, 0.2, i % 2 ? 0.45 : -0.45, 0.3));
    else if (mood === 'sim') { // a short engine rev with a shift blip at the top
      const o = osc('sawtooth', 50), o2 = osc('sawtooth', 25), f = filt('lowpass', 300, 1.6), g = gain(0);
      o.connect(f); o2.connect(f); chain(f, g, out);
      for (const [p, a, b, c] of [[o.frequency, 50, 160, 64], [o2.frequency, 25.1, 80.3, 32.2], [f.frequency, 280, 2200, 380]]) { p.setValueAtTime(a, t); p.exponentialRampToValueAtTime(b, t + 0.32); p.exponentialRampToValueAtTime(c, t + 0.8); }
      g.gain.setValueAtTime(0, t); g.gain.linearRampToValueAtTime(0.035, t + 0.06); g.gain.setValueAtTime(0.035, t + 0.5); g.gain.linearRampToValueAtTime(0, t + 0.85);
      for (const x of [o, o2]) { x.start(t); x.stop(t + 0.9); }
      done(o, [o, o2, f, g]);
      tone(t + 0.32, 1250, { type: 'triangle', vol: 0.014, r: 0.02 });
    } else if (mood === 'vr') {
      [85, 92, 97].forEach((m, i) => tone(t + i * 0.11, mtof(m), { vol: 0.014, a: 0.15, hold: 0.15, r: 0.5, f1: mtof(m + 0.3), rev: 0.9, p: (i - 1) * 0.5 }));
      nz(t, 0.9, { f0: 5200, Q: 0.7, vol: 0.006, swell: true, rev: 0.8 });
    }
  }
  return { play: (k, t) => K[k] && K[k](t), sting, motif };
}
