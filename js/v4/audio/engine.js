// Generative "night lounge" soundtrack (agent A). Pure WebAudio, no files; runs on AudioContext and OfflineAudioContext.
// F# minor, 100 BPM, 16th-note lookahead sequencer, 8-bar phrases chosen by a Markov chain, voice-led chords,
// humanised velocities and fills. Layers crossfade (~2 s) per chapter mood: lobby, ps5, sim, vr.
import { makeSfx } from './sfx.js';

const BPM = 100, S16 = 15 / BPM, BAR = S16 * 16;
export const mtof = (m) => 440 * 2 ** ((m - 69) / 12);
const pc = (m) => ((m % 12) + 12) % 12;
const place = (p, lo) => lo + pc(p - lo);                 // lowest MIDI note >= lo with pitch class p
const SCALE = [0, 2, 3, 5, 7, 8, 10];                     // natural minor from F#
const IN_KEY = new Set(SCALE.map((x) => pc(6 + x)));
const deg = (d) => 54 + 12 * Math.floor(d / 7) + SCALE[((d % 7) + 7) % 7]; // scale degree -> MIDI (7 = F#4)

// Chords: r = bass pitch class, q = required tones (3rd + 7th/6th/sus 4th), o = colour tones (two picked per voicing)
const CH = {
  i9: { r: 6, q: [9, 4], o: [1, 8, 6] },        // F#m9
  VI9: { r: 2, q: [6, 1], o: [9, 4, 2] },       // Dmaj9
  iv11: { r: 11, q: [2, 9], o: [4, 6, 11] },    // Bm11
  Vs: { r: 1, q: [6, 11], o: [8, 1] },          // C#7sus4
  V7: { r: 1, q: [5, 11], o: [8, 1] },          // C#7, resolves the sus at some phrase ends
  III9: { r: 9, q: [1, 8], o: [4, 11, 9] },     // Amaj9
  VII: { r: 8, q: [8, 1], o: [11, 6, 4] },      // E6/G#
  iv9: { r: 11, q: [2, 9], o: [1, 6, 11] },     // Bm9
  bII9: { r: 7, q: [11, 6], o: [9, 2, 7] },     // Gmaj9 (Neapolitan colour)
};
const PHR = { A: ['i9', 'VI9', 'iv11', 'Vs'], B: ['III9', 'VII', 'VI9', 'Vs'], C: ['i9', 'iv9', 'bII9', 'Vs'] };
const NEXT = { A: 'AABBC', B: 'AAAC', C: 'AAB' };
// Motifs for the keys voice: [16th step, scale degree, length in 16ths]
const MOTIFS = [
  [[0, 11, 3], [3, 10, 1], [4, 9, 4], [10, 13, 2], [12, 11, 8]],
  [[0, 9, 2], [2, 11, 2], [4, 13, 6], [14, 12, 2], [16, 11, 6], [24, 9, 6]],
  [[0, 7, 2], [2, 9, 2], [4, 11, 2], [6, 14, 6], [14, 13, 2], [16, 11, 4], [20, 9, 8]],
  [[2, 13, 2], [4, 12, 2], [6, 11, 4], [12, 9, 2], [14, 8, 2], [16, 9, 10]],
];
const GATES = ['x.xx.xx.x.xx.xx.', 'xx.xx.x.xx.xx.x.', 'x.x.xxx.x.x.xx.x', 'x.xxx.xxx.xxx.xx'];
const PATS = [[0, 1, 2, 3, 4, 5, 6, 7], [0, 1, 2, 3, 4, 3, 2, 1], [0, 2, 1, 3, 2, 4, 3, 5], [0, 4, 2, 5, 1, 4, 3, 6], [7, 5, 3, 1, 6, 4, 2, 0]];

// Layer peak levels, calibrated with the offline loudness analysis (redesign-docs/v4/audio-previews)
const LV = { pad: 0.045, sub: 0.13, kick: 0.27, hat: 0.11, clap: 0.12, arp: 0.06, sbass: 0.12, shim: 0.03, keys: 0.09, eng: 0.074, fx: 0.07 };
const MIX = {
  lobby: { pad: 1, sub: 1, kick: 1, hat: 1, clap: 1, keys: 1 },
  ps5: { pad: 0.85, sub: 1, kick: 1, hat: 1, clap: 1, arp: 1, keys: 0.7 },
  sim: { pad: 0.7, kick: 1, hat: 1, clap: 1, sbass: 1, eng: 1 },
  vr: { pad: 1, sub: 0.7, shim: 1, keys: 0.85 },
};
// Per mood: loudness trim, reverb amount, pad filter offset (cents), pad LFO [Hz, cents], hat lowpass, sidechain pump, motif density
const MOOD = {
  lobby: { trim: 0.615, verb: 1, cut: 0, lfo: [0.05, 500], hat: 9000, pump: 0.12, keys: 0.55 },
  ps5: { trim: 0.625, verb: 1, cut: 250, lfo: [0.07, 450], hat: 9500, pump: 0.15, keys: 0.35 },
  sim: { trim: 0.61, verb: 0.7, cut: -200, lfo: [0.1, 350], hat: 10000, pump: 0.3, keys: 0 },
  vr: { trim: 0.465, verb: 1.9, cut: 200, lfo: [0.03, 1100], hat: 9000, pump: 0, keys: 0.8 },
};
const GB = [0, 50, 90, 130, 175, 225, 290];               // engine voice: gear speed bands (km/h)

export function createEngine(ac, opt = {}) {
  const sr = ac.sampleRate;
  let seed = (opt.seed ?? Math.random() * 4294967296) >>> 0;
  const rnd = () => { // mulberry32: seedable, so offline previews are reproducible
    seed = (seed + 0x6d2b79f5) >>> 0; let t = seed;
    t = Math.imul(t ^ (t >>> 15), t | 1); t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
  const pick = (a) => a[Math.floor(rnd() * a.length)];
  const hum = (v, a = 0.12) => v * (1 + (rnd() - 0.5) * 2 * a);
  const gain = (v = 0) => { const g = ac.createGain(); g.gain.value = v; return g; };
  const filt = (type, f, Q = 0.707, db = 0) => { const b = ac.createBiquadFilter(); b.type = type; b.frequency.value = f; b.Q.value = Q; b.gain.value = db; return b; };
  const osc = (type, f) => { const o = ac.createOscillator(); o.type = type; o.frequency.value = f; return o; };
  const pan = (p) => { const s = ac.createStereoPanner(); s.pan.value = p; return s; };
  const chain = (...n) => { for (let i = 1; i < n.length; i++) n[i - 1].connect(n[i]); return n[n.length - 1]; };
  const done = (src, nodes) => { src.onended = () => nodes.forEach((x) => x.disconnect()); };
  const noise = ac.createBuffer(1, sr * 2, sr);
  { const d = noise.getChannelData(0); for (let i = 0; i < d.length; i++) d[i] = rnd() * 2 - 1; }
  const nsrc = (loop) => { const s = ac.createBufferSource(); s.buffer = noise; s.loop = !!loop; return s; };
  // envelope: 0 -> pk in a, then exponential decay (time-constant d)
  const ad = (p, t, pk, a, d) => { p.setValueAtTime(0, t); p.linearRampToValueAtTime(pk, t + a); p.setTargetAtTime(0, t + a, d); };

  // ---- mix: dry -> fade -> pre -> HP 28 -> shelf -> LP -> glue compressor -> trim -> soft clipper -> out
  const out = gain(0), clip = ac.createWaveShaper(), glue = ac.createDynamicsCompressor(), trim = gain(1), pre = gain(1);
  const curve = new Float32Array(1024);  // linear to 0.6, soft knee to a 0.79 (-2 dBFS) ceiling
  for (let i = 0; i < 1024; i++) { const x = i / 511.5 - 1, a = Math.abs(x); curve[i] = Math.sign(x) * (a < 0.6 ? a : 0.6 + 0.2 * Math.tanh((a - 0.6) / 0.2)); }
  clip.curve = curve; clip.oversample = '4x';
  for (const [k, v] of Object.entries({ threshold: -20, knee: 10, ratio: 2, attack: 0.025, release: 0.3 })) glue[k].value = v;
  chain(pre, filt('highpass', 28, 0.6), filt('highshelf', 8000, 0.7, -3), filt('lowpass', 12000, 0.5), glue, trim, clip, out);
  out.connect(ac.destination);
  const dry = gain(1), fade = gain(0); chain(dry, fade, pre);
  // reverb from a generated IR; music sends fade with the music, SFX sends don't
  const conv = ac.createConvolver(); conv.normalize = false; conv.buffer = makeIR(opt.lite ? 2.6 : 3.6);
  const vIn = gain(1), fadeV = gain(0), vPre = ac.createDelay(0.1); vPre.delayTime.value = 0.022;
  chain(vIn, fadeV, vPre, filt('highpass', 220, 0.6), conv, pre);
  const sfxBus = gain(2.2), sfxVerb = gain(2.2);
  chain(sfxBus, filt('lowpass', 9000, 0.6), clip); sfxVerb.connect(vPre);
  // ping-pong delay, dotted 8th, darkening repeats
  const dIn = gain(1); dIn.channelCount = 1; dIn.channelCountMode = 'explicit';
  const dl = ac.createDelay(1), dr = ac.createDelay(1), dLp = filt('lowpass', 2800, 0.6), mg = ac.createChannelMerger(2), dOut = gain(0.6);
  dl.delayTime.value = dr.delayTime.value = S16 * 3;
  chain(dIn, filt('highpass', 320, 0.6), dLp, dl, dr, gain(0.38), dLp);
  dl.connect(mg, 0, 0); dr.connect(mg, 0, 1); chain(mg, dOut, dry); dOut.connect(gain(0.3)).connect(vIn);
  // layers (gain = mood level) with reverb sends; pad-like layers duck under the kick (pump)
  const L = {}, pump = gain(1); pump.connect(dry);
  const SEND = { pad: 0.35, shim: 1, keys: 0.35, arp: 0.25, sbass: 0.04, kick: 0.04, hat: 0.1, clap: 0.4, eng: 0.06, fx: 0.5 };
  for (const k in LV) {
    L[k] = gain(k === 'fx' ? 1 : 0);
    L[k].connect(['pad', 'shim', 'keys', 'arp'].includes(k) ? pump : dry);
    if (SEND[k]) L[k].connect(gain(SEND[k])).connect(vIn);
  }
  L.arp.connect(gain(0.5)).connect(dIn); L.keys.connect(gain(0.3)).connect(dIn);
  // shared buses: pad filter (mood offset + slow LFO), shimmer tremolo, hat band
  const cut = ac.createConstantSource(), lfo = osc('sine', 0.05), lfoG = gain(500), padIn = gain(1), padF = filt('lowpass', 2000, 0.6);
  cut.offset.value = 0; chain(padIn, padF, L.pad); cut.connect(padF.detune); chain(lfo, lfoG, padF.detune);
  const shimIn = gain(1), trem = osc('sine', 0.21); chain(shimIn, filt('highpass', 500, 0.6), L.shim); chain(trem, gain(0.25), shimIn.gain);
  const hatIn = gain(1), hatLp = filt('lowpass', 8000, 0.9); chain(hatIn, filt('highpass', 5500, 0.7), hatLp, pan(0.22), L.hat);
  [cut, lfo, trem].forEach((s) => s.start());

  function makeIR(sec) { // decaying stereo noise; highs die faster (time-varying one-pole lowpass); energy-normalised
    const len = Math.floor(sr * sec), b = ac.createBuffer(2, len, sr), q = Math.exp(-6.9 / (sec * 0.85) / sr), qa = Math.exp(-3 / sr);
    for (let c = 0; c < 2; c++) {
      const d = b.getChannelData(c); let lp = 0, env = 1, a = 0.7, e = 0;
      for (let i = 0; i < len; i++) {
        lp += (a + 0.06) * (rnd() * 2 - 1 - lp); a *= qa; env *= q;
        d[i] = lp * env * Math.min(1, i / (sr * 0.004)); e += d[i] * d[i];
      }
      const s = 1 / Math.sqrt(e); for (let i = 0; i < len; i++) d[i] *= s;
    }
    return b;
  }

  // ---- instruments
  function pad(t, v, dur) { // warm detuned saw pairs, spread wide
    const g = gain(0), pl = pan(-0.6), pr = pan(0.6), end = t + dur, nodes = [g, pl, pr];
    pl.connect(g); pr.connect(g); g.connect(padIn);
    g.gain.setValueAtTime(0, t); g.gain.linearRampToValueAtTime(LV.pad, t + 0.45); g.gain.setValueAtTime(LV.pad, end); g.gain.setTargetAtTime(0, end, 0.4);
    for (const m of v) for (const p of [pl, pr]) {
      const o = osc('sawtooth', mtof(m)); o.detune.value = (p === pl ? -1 : 1) * (6 + rnd() * 5);
      o.connect(p); o.start(t); o.stop(end + 2.6); nodes.push(o);
    }
    done(nodes[3], nodes);
  }
  function shim(t, v, dur) { // airy high chord tones, slow swell
    const g = gain(0), end = t + dur, nodes = [g]; g.connect(shimIn);
    g.gain.setValueAtTime(0, t); g.gain.linearRampToValueAtTime(LV.shim, t + 2); g.gain.setValueAtTime(LV.shim, end); g.gain.setTargetAtTime(0, end, 0.8);
    [v[0] + 12, v[2] + 12, v[1] + 24, v[3] + 24].forEach((m, i) => {
      const o = osc(i < 2 ? 'triangle' : 'sine', mtof(m)), p = pan(i & 1 ? 0.7 : -0.7);
      o.detune.value = (rnd() - 0.5) * 10; chain(o, p, g); o.start(t); o.stop(end + 5); nodes.push(o, p);
    });
    const s = nsrc(true), bf = filt('bandpass', 6500, 0.8), bg = gain(0.2); chain(s, bf, bg, g); // a breath of air
    s.start(t, rnd()); s.stop(end + 5); nodes.push(s, bf, bg);
    done(nodes[1], nodes);
  }
  function sub(t, m, dur, vel) { // sine sub + filtered triangle an octave up (audible on small speakers)
    const o = osc('sine', mtof(m)), o2 = osc('triangle', mtof(m + 12)), g = gain(0), g2 = gain(0.35), f = filt('lowpass', 520, 0.7), pk = LV.sub * vel, end = t + dur;
    o.connect(g); chain(o2, g2, f, g); g.connect(L.sub);
    g.gain.setValueAtTime(0, t); g.gain.linearRampToValueAtTime(pk, t + 0.012); g.gain.setTargetAtTime(pk * 0.75, t + 0.05, 0.4); g.gain.setTargetAtTime(0, end, 0.04);
    for (const x of [o, o2]) { x.start(t); x.stop(end + 0.3); }
    done(o, [o, o2, g, g2, f]);
  }
  function sbass(t, m, vel) { // driving 8th-note bass: two saws through an enveloped resonant lowpass + sine sub
    const f0 = mtof(m), o = osc('sawtooth', f0), o2 = osc('sawtooth', f0 * 1.006), s = osc('sine', f0 / 2), f = filt('lowpass', 1, 3.5), g = gain(0), gs = gain(0.6), pk = LV.sbass * vel, d = S16 * 1.7;
    o.connect(f); o2.connect(f); chain(f, g, L.sbass); chain(s, gs, g);
    f.frequency.setValueAtTime(260 + 1300 * vel, t); f.frequency.setTargetAtTime(170, t + 0.004, 0.07);
    g.gain.setValueAtTime(0, t); g.gain.linearRampToValueAtTime(pk, t + 0.004); g.gain.setTargetAtTime(pk * 0.55, t + 0.01, 0.08); g.gain.setTargetAtTime(0, t + d, 0.015);
    for (const x of [o, o2, s]) { x.start(t); x.stop(t + d + 0.12); }
    done(o, [o, o2, s, f, g, gs]);
  }
  function kick(t, vel, hard, pd) {
    const o = osc('sine', 1), g = gain(0); chain(o, g, L.kick);
    o.frequency.setValueAtTime(hard ? 150 : 110, t); o.frequency.exponentialRampToValueAtTime(hard ? 47 : 44, t + (hard ? 0.09 : 0.12));
    ad(g.gain, t, LV.kick * vel, 0.003, hard ? 0.09 : 0.12);
    o.start(t); o.stop(t + 0.9); done(o, [o, g]);
    if (pd) { pump.gain.setTargetAtTime(1 - pd, t, 0.006); pump.gain.setTargetAtTime(1, t + 0.05, 0.12); }
  }
  function hat(t, vel, dec) {
    const s = nsrc(), g = gain(0); chain(s, g, hatIn);
    ad(g.gain, t, LV.hat * vel, 0.0015, dec / 2.5);
    s.start(t, rnd() * 1.5); s.stop(t + dec * 3 + 0.02); done(s, [s, g]);
  }
  function clap(t, vel) { // three quick bursts + a short tail, mostly heard through the reverb
    const s = nsrc(), f = filt('bandpass', 1700, 0.9), g = gain(0), p = g.gain, pk = LV.clap * vel; chain(s, f, g, L.clap);
    p.setValueAtTime(0, t);
    for (const o of [0, 0.011]) { p.linearRampToValueAtTime(pk, t + o + 0.001); p.linearRampToValueAtTime(pk * 0.25, t + o + 0.01); }
    p.linearRampToValueAtTime(pk, t + 0.023); p.setTargetAtTime(0, t + 0.024, 0.045);
    s.start(t, rnd()); s.stop(t + 0.4); done(s, [s, f, g]);
  }
  function pluck(t, m, vel) { // bright pluck for the ps5 arpeggio
    const f0 = mtof(m), o = osc('sawtooth', f0), o2 = osc('square', f0 * 1.004), f = filt('lowpass', 1, 2.2), g = gain(0), g2 = gain(0.5);
    o.connect(f); chain(o2, g2, f); chain(f, g, L.arp);
    f.frequency.setValueAtTime(Math.min(6500, f0 * 6 * (0.6 + vel * 0.5)), t); f.frequency.setTargetAtTime(Math.max(300, f0 * 1.2), t + 0.003, 0.07);
    ad(g.gain, t, LV.arp * vel, 0.003, 0.11);
    for (const x of [o, o2]) { x.start(t); x.stop(t + 0.85); }
    done(o, [o, o2, f, g, g2]);
  }
  function keys(t, m, dur, vel) { // soft FM electric piano for the motifs
    const f0 = mtof(m), c = osc('sine', f0), md = osc('sine', f0), mg = gain(0), g = gain(0), p = pan(-0.18), pk = LV.keys * vel;
    chain(md, mg, c.frequency); chain(c, g, p, L.keys);
    mg.gain.setValueAtTime(f0 * 1.3 * vel, t); mg.gain.setTargetAtTime(f0 * 0.25, t, 0.25);
    g.gain.setValueAtTime(0, t); g.gain.linearRampToValueAtTime(pk, t + 0.005); g.gain.setTargetAtTime(pk * 0.5, t + 0.01, 0.5); g.gain.setTargetAtTime(0, t + dur, 0.18);
    for (const x of [c, md]) { x.start(t); x.stop(t + dur + 1.2); }
    done(c, [c, md, mg, g, p]);
  }
  function riser(t) { // noise sweep + gliding saw, landing on the next downbeat at least 1.8 s away
    let e = nt + ((16 - (n & 15)) & 15) * S16; while (e < t + 1.8) e += BAR;
    const s = nsrc(true), f = filt('bandpass', 250, 2), g = gain(0), o = osc('sawtooth', mtof(42)), of = filt('lowpass', 300, 1), og = gain(0);
    chain(s, f, g, L.fx); chain(o, of, og, L.fx);
    for (const [p, a, b] of [[f.frequency, 250, 4200], [o.frequency, mtof(42), mtof(54)], [of.frequency, 300, 2400]]) { p.setValueAtTime(a, t); p.exponentialRampToValueAtTime(b, e); }
    for (const [p, pk] of [[g.gain, LV.fx], [og.gain, LV.fx * 0.4]]) { p.setValueAtTime(0, t); p.linearRampToValueAtTime(pk * 0.25, t + (e - t) * 0.6); p.linearRampToValueAtTime(pk, e - 0.03); p.linearRampToValueAtTime(0, e + 0.02); }
    for (const x of [s, o]) { x.start(t); x.stop(e + 0.1); }
    done(s, [s, f, g, o, of, og]);
  }
  function swell(t, d) { // soft reverse-cymbal swell into the next phrase
    const s = nsrc(), f = filt('highpass', 2500, 0.7), g = gain(0); chain(s, f, g, L.fx);
    g.gain.setValueAtTime(0, t); g.gain.linearRampToValueAtTime(LV.fx * 0.35, t + d - 0.02); g.gain.linearRampToValueAtTime(0, t + d + 0.01);
    s.start(t, rnd()); s.stop(t + d + 0.05); done(s, [s, f, g]);
  }

  // ---- engine voice (sim): saws + amplitude-modulated noise through a lowpass, pitch and filter follow |scroll velocity|
  let E = null, thr = 0, spd = 0, gear = 1, lastT = 0, lift = -9, blip = -9, readout = { rpm: 0, gear: 0, kmh: 0 };
  function engOn(t) {
    if (E) return;
    const o1 = osc('sawtooth', 33), o2 = osc('sawtooth', 16.6), am = osc('sine', 33), nz = nsrc(true);
    const g1 = gain(0.55), g2 = gain(0.4), g3 = gain(0.5), nzg = gain(0.5), amg = gain(0.5), nbp = filt('bandpass', 170, 0.9), lp = filt('lowpass', 320, 1.1), sh = ac.createWaveShaper(), eg = gain(0);
    const c = new Float32Array(256); for (let i = 0; i < 256; i++) c[i] = Math.tanh((i / 127.5 - 1) * 1.8) / Math.tanh(1.8);
    sh.curve = c;
    chain(o1, g1, lp); chain(o2, g2, lp); chain(nz, nbp, nzg, g3, lp); chain(am, amg, nzg.gain); chain(lp, sh, eg, L.eng);
    [o1, o2, am, nz].forEach((s) => s.start(t));
    E = { o1, o2, am, nbp, lp, eg, all: [o1, o2, am, nz, g1, g2, g3, nzg, amg, nbp, lp, sh, eg] };
    lastT = t; thr = spd = 0; gear = 1;
  }
  function engOff(t) {
    if (!E) return; const e = E; E = null;
    e.eg.gain.cancelScheduledValues(t); e.eg.gain.setTargetAtTime(0, t, 0.25);
    e.all.slice(0, 4).forEach((s) => s.stop(t + 2)); done(e.o1, e.all);
  }
  function shift(t, up) { // quiet shift-light blip
    const o = osc('triangle', up ? 1250 : 940), g = gain(0); chain(o, g, L.eng);
    ad(g.gain, t, up ? 0.03 : 0.02, 0.004, 0.018); o.start(t); o.stop(t + 0.2); done(o, [o, g]);
  }
  function rev(v, t, tach) { // tach = state.tach {rpm, gear, speed} from the HUD when present, else our own model
    if (!E) return;
    const dt = Math.min(0.2, Math.max(0.001, t - lastT)), tg = Math.min(1, Math.abs(v) / 40); lastT = t;
    thr += (tg - thr) * (1 - Math.exp(-dt / (tg > thr ? 0.12 : 0.6)));          // throttle: fast attack, slow release
    let rpm;
    if (tach && tach.rpm > 0) {
      const g = Math.max(1, +tach.gear || 1);
      if (g !== gear) { if (g > gear) lift = t; shift(t, g > gear); gear = g; }
      rpm = Math.min(8500, Math.max(800, tach.rpm)); spd = +tach.speed || 0;
    } else {
      const goal = thr * 280; spd += (goal - spd) * (1 - Math.exp(-dt / (goal > spd ? 1.1 : 1.8)));
      if (gear < 6 && spd > GB[gear]) { gear++; lift = t; shift(t, 1); }          // upshift: brief throttle lift
      else if (gear > 1 && spd < GB[gear - 1] - 6) { gear--; blip = t; shift(t, 0); } // downshift: rev-matching blip
      const x = Math.min(1, Math.max(0, (spd - GB[gear - 1]) / (GB[gear] - GB[gear - 1])));
      rpm = (gear === 1 ? 1000 + x * 6200 : 4300 + x * 2900) + 900 * Math.max(0, 1 - (t - blip) / 0.2);
    }
    const f = rpm / 30, lifted = t - lift < 0.12, load = Math.min(1, Math.max(0, (rpm - 1000) / 6200));
    const P = [[E.o1.frequency, f, 0.04], [E.o2.frequency, f * 0.502, 0.04], [E.am.frequency, f, 0.04], [E.nbp.frequency, f * 5, 0.05],
      [E.lp.frequency, (150 + rpm * 0.3) * (lifted ? 0.6 : 0.7 + 0.5 * thr), 0.06],
      [E.eg.gain, LV.eng * (lifted ? 0.5 : 0.32 + 0.22 * load + 0.16 * thr), 0.08]];
    for (const [p, val, k] of P) p.setTargetAtTime(val, t, k);
    readout = { rpm: Math.round(rpm), gear, kmh: Math.round(spd) };
  }

  // ---- sequencer
  let mood = 'lobby', barMood = 'lobby', running = false, n = 0, nt = 0, phr = 'A', plan = null, cur = null;
  let prevV = [57, 61, 64, 68], arp = { g: GATES[0], p: PATS[0], k: 0 };
  const act = {}; // layer -> time until which its notes are still scheduled (Infinity while on)

  function voice(C) { // 4-note voicing in F3..D5 nearest to the previous one (voice-leading)
    let best = prevV, bc = 1e9;
    for (const [a, b] of C.o.length > 2 ? [[0, 1], [0, 2], [1, 2]] : [[0, 1]]) {
      const pcs = [...C.q, C.o[a], C.o[b]];
      for (let mask = 0; mask < 16; mask++) {
        const v = pcs.map((p, i) => place(p, 53) + ((mask >> i) & 1) * 12).sort((x, y) => x - y);
        if (v[3] > 74 || v[3] - v[0] > 16 || v[3] - v[0] < 7) continue;
        let c = rnd() * 1.5 + (v[1] - v[0] < 3 ? 3 : 0);
        for (let i = 0; i < 4; i++) c += Math.abs(v[i] - prevV[i]);
        if (c < bc) { bc = c; best = v; }
      }
    }
    return (prevV = best);
  }
  function newPhrase() {
    phr = n === 0 ? 'A' : pick(NEXT[phr]);
    const chords = PHR[phr].map((c, i) => [i * 32, c]), ev = {}, slow = mood === 'vr';
    if (rnd() < 0.5) chords.push([120, 'V7']);
    if (rnd() < MOOD[mood].keys) { // call (bars 1-2) and response (bars 5-6); half speed in vr
      const a = pick(MOTIFS), b = rnd() < 0.4 ? a : pick(MOTIFS);
      [[a, 0], [b, 64]].forEach(([m, off], j) => m.forEach(([s, d, l]) => {
        if (j && rnd() < 0.12) return;
        const st = off + (slow ? s * 2 : s);
        if (st < 128) ev[st] = [deg(d) + (rnd() < 0.1 ? 12 : 0), slow ? l * 2 : l, hum(0.8, 0.15)];
      }));
    }
    plan = { chords, ev, fill: rnd() < 0.7 };
  }
  function snap(m, s) { // keep motif notes consonant with the current chord
    if (cur.tones.has(pc(m))) return m;
    if (s % 4 === 0) for (const d of [-1, 1, -2, 2]) if (cur.tones.has(pc(m + d))) return m + d;
    return cur.tones.has(pc(m - 1)) ? m - 1 : m;
  }
  function step(i, t) {
    const s = i & 15, ps = i & 127, bar = ps >> 4;
    if (!ps || !plan) newPhrase();
    if (!s) barMood = mood;
    const M = barMood, sim = M === 'sim', sw = s & 1 ? S16 * 0.12 : 0, on = (k) => act[k] > t;
    for (const [at, c] of plan.chords) if (at === ps) {
      const C = CH[c], len = ((plan.chords.find(([a]) => a > at) || [128])[0] - at) * S16;
      cur = { C, v: voice(C), b: place(C.r, 30), tones: new Set([C.r, ...C.q, ...C.o]) };
      if (on('pad')) pad(t, cur.v, len);
      if (on('shim')) shim(t, cur.v, len);
      arp = { g: pick(GATES), p: pick(PATS), k: 0 };
    }
    if (!cur) return;
    if (on('sub')) {
      if (M === 'vr') { if (!s && plan.chords.some(([a]) => a === ps)) sub(t, cur.b, BAR * 1.9, 0.75); }
      else if (s === 0 || s === 6 || s === 12) { // 3+3+2 syncopation, chromatic or scale approach into chord changes
        let m = cur.b; const nx = s === 12 && plan.chords.find(([a]) => a === ps + 4);
        if (nx && rnd() < 0.4) { const tb = place(CH[nx[1]].r, 30); m = rnd() < 0.5 ? tb - 1 : IN_KEY.has(pc(tb + 2)) ? tb + 2 : tb + 1; }
        sub(t, m, (s === 12 ? 3.6 : 5.6) * S16, s ? 0.8 : 1);
      }
    }
    if (on('sbass') && !(s & 1)) sbass(t, cur.b + 12 + ((s === 14 && rnd() < 0.45) || (s === 6 && rnd() < 0.2) ? 12 : 0), hum(s % 4 ? 0.7 : 1, 0.08));
    if (M !== 'vr') {
      const fill = plan.fill && bar === 7 && s >= 12;
      if (on('kick')) {
        const k = sim ? (s % 4 ? 0 : 1) : !s ? 1 : s === 8 ? 0.85 : (s === 6 || s === 11) && rnd() < 0.15 ? 0.45 : 0;
        if (k) kick(t, hum(k, 0.05), sim, MOOD[M].pump);
      }
      if (on('clap') && (s === 4 || s === 12)) clap(t, hum(sim ? 0.9 : 0.7, 0.08));
      if (on('hat')) {
        let h = sim ? [0.3, 0.2, 0.85, 0.2][s & 3] : s & 1 ? (rnd() < 0.12 ? 0.3 : 0) : s & 2 ? 0.8 : 0.4;
        if (fill) h = 0.35 + (s - 12) * 0.15;
        if (!sim && s === 14 && (bar & 3) === 3) { hat(t, 0.5, 0.25); h = 0; }
        if (h) hat(t + sw, hum(h), sim ? 0.022 : 0.034);
      }
      if (fill && s === 12 && rnd() < 0.4) swell(t, S16 * 4);
    }
    if (on('arp') && arp.g[s] === 'x') {
      const pool = cur.v.concat(cur.v.map((x) => x + 12));
      pluck(t + sw, pool[arp.p[arp.k++ % arp.p.length]], hum(s % 4 ? (s & 1 ? 0.55 : 0.75) : 1, 0.1));
    }
    const e = plan.ev[ps];
    if (e && on('keys')) keys(t + sw, snap(e[0], s), e[1] * S16, e[2]);
  }
  function tick(now, ahead = 0.25) {
    if (!running) return;
    if (nt < now - 0.05) { const k = Math.ceil((now - nt) / S16); n += k; nt += k * S16; } // main thread stalled: skip, don't burst
    while (nt < now + ahead) { step(n, nt); n++; nt += S16; }
  }
  function setMood(m, t, instant) {
    if (!MIX[m]) m = 'lobby';
    const prev = mood, P = MOOD[m], tc = instant ? 0.01 : 0.55; mood = m;
    for (const k in L) if (k !== 'fx') {
      const v = MIX[m][k] || 0; L[k].gain.setTargetAtTime(v, t, tc);
      act[k] = v > 0 ? Infinity : Math.min(act[k] ?? 0, t + 3);
    }
    for (const [p, v, k] of [[trim.gain, P.trim, tc], [vIn.gain, P.verb, tc], [cut.offset, P.cut, instant ? 0.01 : 1.2], [lfo.frequency, P.lfo[0], 1], [lfoG.gain, P.lfo[1], 1.5], [hatLp.frequency, P.hat, 0.5]]) p.setTargetAtTime(v, t, k);
    if (running) { if (m === 'sim') { engOn(t); if (prev !== 'sim' && !instant) riser(t); } else engOff(t); }
  }
  function fadeIn(t, d = 1.5) {
    const o = out.gain; o.cancelScheduledValues(t); o.setValueAtTime(o.value, t); o.linearRampToValueAtTime(1, t + 0.03);
    for (const g of [fade, fadeV]) { const p = g.gain; p.cancelScheduledValues(t); p.setValueAtTime(p.value, t); p.linearRampToValueAtTime(0, t + 0.03); p.linearRampToValueAtTime(0.3, t + d * 0.45); p.linearRampToValueAtTime(1, t + d); }
  }
  function fadeOut(t, d = 0.4) { const o = out.gain; o.cancelScheduledValues(t); o.setValueAtTime(o.value, t); o.linearRampToValueAtTime(0, t + d); }

  const fx = makeSfx({ ac, gain, filt, osc, pan, chain, done, nsrc, rnd, mtof, out: sfxBus, verb: sfxVerb });
  return {
    start(t) { running = true; n = 0; nt = t; plan = null; if (mood === 'sim') engOn(t); },
    stop(t) { running = false; engOff(t); },
    tick, setMood, rev, fadeIn, fadeOut, sfx: fx.play, sting: fx.sting, motif: fx.motif,
    get mood() { return mood; }, get running() { return running; }, get engine() { return E ? readout : null; }, _layers: L,
  };
}
