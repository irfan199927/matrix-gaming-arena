/* ═══════════════════════════════════════════════════════════════
   THE MATRIX GAMING ARENA V4: the WebGL stage (agent G)
   init(ctx) → Promise<{ dispose, stats }>; ctx = { bus, state, root } (redesign-docs/v4/00-spec.md §6)

   One fixed, transparent canvas behind the content (z 1). Three models follow their chapter anchors
   [data-gl-anchor="hero|ps5|sim|vr"]: the controller (hero: exploded view scrubbed while pinned, with
   callouts; ps5: slow scroll-tied turn, light bars lit), the wheel (sim: steering from scroll velocity,
   paddle flicks) and the headset (vr: pointer-following portal into a procedural world). Between ps5 →
   sim → vr the solid burns away into particles that fly and re-form as the next model, scrubbed by scroll.
   Renders only while a 3D chapter or a morph zone is on screen; stops when the tab is hidden.
   Events out: gl:progress {p}, gl:ready {tier}; html.gl-on while drawing.
   ═══════════════════════════════════════════════════════════════ */
const FOV = 24, CAM_D = 12, TAN = Math.tan((FOV * Math.PI) / 360);
const SCENES = [
  { id: 'hero', model: 'controller', fit: 0.96 },
  { id: 'ps5', model: 'controller', fit: 0.94 },
  { id: 'sim', model: 'wheel', fit: 0.94 },
  { id: 'vr', model: 'headset', fit: 0.84 },
];
// canonical poses, Euler YXZ (x = pitch toward the camera, y = yaw)
const POSE = {
  hero: { x: 1.02, y: -0.32, z: 0.05 },
  explode: { x: 0.34, y: -0.66, z: 0 },
  ps5: { x: 0.94, y: 0, z: 0.03 },
  sim: { x: 0.14, y: -0.36, z: 0 },
  vr: { x: 0.1, y: -0.5, z: 0 },
};
// hero timeline in pin progress h (0..1)
const HX = { toE: [0.04, 0.3], out: 0.1, outDur: 0.17, outSpread: 0.5, snap: 0.66, snapDur: 0.11, snapSpread: 0.3, back: [0.68, 0.92], lab: [0.3, 0.5], labOut: [0.6, 0.68] };

const clamp = (v, a, b) => (v < a ? a : v > b ? b : v);
const clamp01 = (v) => clamp(v, 0, 1);
const seg = (t, a, b) => clamp01((t - a) / (b - a));
const lerp = (a, b, t) => a + (b - a) * t;
const outCubic = (t) => 1 - (1 - t) ** 3;
const outQuart = (t) => 1 - (1 - t) ** 4;
const inOutCubic = (t) => (t < 0.5 ? 4 * t * t * t : 1 - (-2 * t + 2) ** 3 / 2);
const inOutSine = (t) => -(Math.cos(Math.PI * t) - 1) / 2;
const damp = (k, dt) => 1 - Math.exp(-k * dt);
// magnetic reassembly: 1 (apart) → accelerates in → contact → small overshoot → 0
const snapF = (u) => {
  if (u <= 0) return 1;
  if (u < 0.64) { const k = u / 0.64; return 1 - k * k * k; }
  const s = (u - 0.64) / 0.36;
  return -0.05 * Math.sin(s * Math.PI * 1.6) * Math.exp(-s * 4);
};
// light bars: flicker on, then hold
const ignite = (u) => (u < 0 ? 0 : u < 0.05 ? (u / 0.05) * 0.8 : u < 0.11 ? lerp(0.8, 0.15, (u - 0.05) / 0.06) : u < 0.45 ? lerp(0.15, 1, outCubic((u - 0.11) / 0.34)) : 1);

let instance = null;
export function init(ctx = {}) {
  if (!instance) {
    instance = start(ctx).catch((e) => {
      console.warn('[gl] stage unavailable:', e && e.message ? e.message : e);
      document.documentElement.classList.remove('gl-on');
      instance = null;
      return { dispose() {}, stats: () => null };
    });
  }
  return instance;
}

async function start(ctx) {
  const html = document.documentElement;
  const bus = ctx.bus && typeof ctx.bus.emit === 'function' ? ctx.bus : { on: () => () => {}, emit() {} };
  const state = ctx.state || {};
  const tier = Number(state.tier ?? html.dataset.tier ?? 0);
  const reduce = state.reduce ?? matchMedia('(prefers-reduced-motion: reduce)').matches;
  if (!(tier > 0) || reduce) return { dispose() {}, stats: () => null };
  const T0 = performance.now();
  const lite = tier < 2;
  const touch = !!state.touch || matchMedia('(hover: none), (pointer: coarse)').matches;
  const debug = /[?&]gldebug\b/.test(location.search) || window.__MXGL_DEBUG === true;
  const COUNT = lite ? 10000 : 30000;
  let disposed = false;
  const progress = (p) => bus.emit('gl:progress', { p: Math.round(p * 100) / 100 });
  progress(0.02);

  const [THREE, S, MO, PO, LA, { RoomEnvironment }] = await Promise.all([
    import('three'), import('./studio.js'), import('./morph.js'), import('./portal.js'), import('./labels.js'),
    import('three/addons/environments/RoomEnvironment.js'), import('./models/controller.js'),
  ]);
  progress(0.35);

  /* ── stage DOM + renderer ── */
  const stage = document.createElement('div');
  stage.className = 'gl-stage';
  stage.setAttribute('aria-hidden', 'true');
  const canvas = document.createElement('canvas');
  canvas.className = 'gl-canvas';
  stage.appendChild(canvas);
  document.body.prepend(stage);
  let renderer;
  try {
    renderer = new THREE.WebGLRenderer({
      canvas, antialias: true, alpha: true, premultipliedAlpha: true, stencil: false,
      powerPreference: 'high-performance', failIfMajorPerformanceCaveat: true,
    });
  } catch (e) { stage.remove(); throw e; }
  const DPR_MAX = lite ? 1.5 : 2;
  let dprScale = 1, W = 1, H = 1, visH = 1, visW = 1, pxPerUnit = 1;
  const dpr = () => Math.max(0.75, Math.min(window.devicePixelRatio || 1, DPR_MAX) * dprScale);
  renderer.setClearColor(0x000000, 0);
  renderer.toneMapping = THREE.ACESFilmicToneMapping;
  renderer.toneMappingExposure = 1.02;
  const gl = renderer.getContext();
  const loseExt = gl.getExtension('WEBGL_lose_context');

  const scene = new THREE.Scene();
  const camera = new THREE.PerspectiveCamera(FOV, 1, 0.1, 100);
  camera.position.set(0, 0, CAM_D);
  function applySize() {
    W = Math.max(1, stage.clientWidth || innerWidth);
    H = Math.max(1, stage.clientHeight || innerHeight);
    renderer.setPixelRatio(dpr());
    renderer.setSize(W, H, false);
    camera.aspect = W / H;
    camera.updateProjectionMatrix();
    camera.updateMatrixWorld();
    visH = 2 * CAM_D * TAN; visW = visH * camera.aspect; pxPerUnit = H / visH;
  }
  applySize();
  const lights = S.createLights(THREE, scene);
  const env = S.createEnvironment(THREE, renderer, scene, RoomEnvironment);
  progress(0.45);

  /* ── shared FX ── */
  const shadow = S.createShadow(THREE);
  scene.add(shadow.mesh);
  const halo = S.createGlow(THREE, [{ p: new THREE.Vector3(), size: 1, kind: 2 }]);
  halo.mesh.renderOrder = -6;
  scene.add(halo.mesh);
  const P = MO.createParticles(THREE, { ice: S.ICE, accent: S.ACCENT });
  scene.add(P.points);
  const portal = PO.createPortal(THREE, { accent: S.ACCENT });
  scene.add(portal.mesh);
  const labels = LA.createLabels(THREE, stage);

  /* ── models ── */
  const models = {};
  const pairs = {};
  const UP = new THREE.Vector3(0, 1, 0), DOWN = new THREE.Vector3(0, -1, 0);
  const localDir = (pose, dir) => dir.clone().applyQuaternion(new THREE.Quaternion().setFromEuler(new THREE.Euler(pose.x, pose.y, pose.z, 'YXZ')).invert()).normalize();
  function addModel(name, ds) {
    const holder = new THREE.Group(), pivot = new THREE.Group();
    pivot.rotation.order = 'YXZ';
    holder.add(pivot); pivot.add(ds.group);
    holder.visible = false;
    scene.add(holder);
    const U = S.createDissolveUniforms(THREE);
    U.uDisR.value = ds.anchors.radius;
    for (const m of ds.materials) S.patchDissolve(THREE, m, U);
    const rec = { name, ds, holder, pivot, U, acc: S.accentMaterials(ds), radius: ds.anchors.radius, glow: null, pxR: 0, cx: 0, cy: 0, base: 1, samples: null, scene: null };
    if (ds.parts) rec.partList = Object.values(ds.parts).filter((q) => q.rest && q.offset);
    if (name === 'controller' && ds.anchors.lightBars) {
      const items = [];
      for (const bar of ds.anchors.lightBars) {
        for (let i = 0; i <= 6; i++) items.push({ p: bar.a.clone().lerp(bar.b, i / 6).addScaledVector(bar.normal, 0.006), size: 0.07, kind: 0 });
        items.push({ p: bar.mid.clone().addScaledVector(bar.normal, 0.02), size: 0.46, kind: 1 });
      }
      rec.glow = S.createGlow(THREE, items);
      ds.parts.lightBars.group.add(rec.glow.mesh);
      const ex = ds.anchors.exploded;
      rec.centerY = (ex.min.y + ex.max.y) / 2;
      rec.exR = ex.getSize(new THREE.Vector3()).length() / 2;
    }
    if (rec.partList?.length) explode(rec, 0); // internals stay hidden until the hero explodes
    rec.steer = ds.parts?.steer?.group || ds.steer || null;
    rec.paddles = ['paddleL', 'paddleR'].map((k) => ds.parts?.[k]?.group || null);
    models[name] = rec;
    return rec;
  }
  // rest pose for sampling: assembled, centred, no steering
  function withRest(rec, fn) {
    const saved = [];
    for (const q of rec.partList || []) { saved.push([q, q.group.position.clone(), q.group.rotation.x, q.group.visible]); q.group.position.copy(q.rest); q.group.rotation.x = 0; }
    const st = rec.steer ? rec.steer.rotation.z : 0;
    if (rec.steer) rec.steer.rotation.z = 0;
    try { return fn(); } finally {
      for (const [q, p, rx, v] of saved) { q.group.position.copy(p); q.group.rotation.x = rx; q.group.visible = v; }
      if (rec.steer) rec.steer.rotation.z = st;
    }
  }
  function sample(rec) {
    if (rec.samples) return rec.samples;
    const skip = (o) => o.material?.isShaderMaterial || !!rec.ds.parts?.[o.name]?.internal;
    rec.samples = withRest(rec, () => MO.sampleModel(THREE, rec.ds, COUNT, skip));
    return rec.samples;
  }
  function buildPair(a, sa, b, sb) {
    const A = models[a], B = models[b];
    const kA = MO.dissolveKeys(sample(A), localDir(POSE[sa], UP), A.radius);
    const kB = MO.dissolveKeys(sample(B), localDir(POSE[sb], DOWN), B.radius);
    pairs[`${a}>${b}`] = { geo: MO.buildPair(THREE, A.samples, kA, B.samples, kB), axA: localDir(POSE[sa], UP), axB: localDir(POSE[sb], DOWN) };
  }

  const tb = performance.now();
  const ctrl = addModel('controller', await S.loadModel(THREE, 'controller'));
  const buildMs = Math.round(performance.now() - tb);
  progress(0.62);

  /* ── lifecycle state ── */
  let raf = 0, lastNow = 0, clock = 0, lost = false, drawing = false, firstT = -1, readyT = html.classList.contains('gate-on') ? null : 0;
  let compiling = null, dirty = true, lastS = -1, moving = false, still = 0, order = [], sections = [];
  let toneNow = '', readyEmitted = false, dark = 0, darkT = 0, darkTick = 0, heroH = 0, mS = 0, steer = 0, steerV = 0, lastDir = 0;
  const paddle = [{ a: 0, v: 0 }, { a: 0, v: 0 }];
  const pv = { x: 0, y: 0 }, portalC = { x: -1, y: -1, open: 0 };
  const stats = { tier, count: COUNT, buildMs, dpr: 0, firstFrameMs: 0, firstFrameSinceInitMs: 0, calls: 0, triangles: 0, points: 0, peakCalls: 0, peakTriangles: 0, mode: 'idle', m: 0, h: 0, level: 0, placeholders: [] };
  const FT = new Float32Array(1200);
  let ftN = 0, ftI = 0;
  const guard = { buf: new Float32Array(120), n: 0, i: 0, warm: 0, level: 0 };
  const offs = [];
  const on = (t, ev, fn, o) => { t.addEventListener(ev, fn, o); offs.push(() => t.removeEventListener(ev, fn, o)); };

  /* ── layout cache: anchor rects in document space, pin-aware (GSAP pin-spacer or CSS sticky) ── */
  const MOTION = () => ctx.motion?.ScrollTrigger || window.ScrollTrigger;
  function findPin(el, r, s0) {
    for (let n = el; n && n !== document.body; n = n.parentElement) {
      const p = n.parentElement;
      if (p && p.classList.contains('pin-spacer')) {
        const sp = p.getBoundingClientRect(), nr = n.getBoundingClientRect();
        const spTop = sp.top + s0;
        let start = spTop, end = spTop + Math.max(0, p.offsetHeight - n.offsetHeight);
        const st = MOTION()?.getAll?.().find((t) => t.pin === n);
        if (st && Number.isFinite(st.start) && Number.isFinite(st.end) && st.end > st.start) { start = st.start; end = st.end; }
        return { start, end, fixedTop: r.top - nr.top + (spTop - start) };
      }
      if (n.classList.contains('chapter-sec')) break;
      if (getComputedStyle(n).position === 'sticky') {
        const c = n.parentElement, cr = c.getBoundingClientRect(), cs = getComputedStyle(c), nr = n.getBoundingClientRect();
        const T = parseFloat(getComputedStyle(n).top) || 0;
        const start = cr.top + s0 + (parseFloat(cs.paddingTop) || 0) - T;
        const end = cr.bottom + s0 - (parseFloat(cs.paddingBottom) || 0) - n.offsetHeight - T;
        if (end > start) return { start, end, fixedTop: r.top - nr.top + T };
      }
    }
    return null;
  }
  function measure() {
    dirty = false;
    const s0 = window.scrollY;
    order = [];
    for (const sc of SCENES) {
      sc.box = null;
      const el = document.querySelector(`[data-gl-anchor="${sc.id}"]`);
      if (!el) continue;
      const r = el.getBoundingClientRect();
      if (r.width < 2 || r.height < 2) continue;
      const box = { left: r.left, w: r.width, h: r.height, docTop: r.top + s0, pin: findPin(el, r, s0) };
      if (box.pin) { box.inS = box.pin.start; box.outS = box.pin.end; } else box.inS = box.outS = box.docTop + box.h / 2 - H / 2;
      sc.box = box;
      order.push(sc);
    }
    order.sort((a, b) => a.box.inS - b.box.inS);
    sections = [...document.querySelectorAll('[data-theme].chapter-sec, section[data-theme], footer[data-theme]')].map((el) => {
      const r = el.getBoundingClientRect();
      return { top: r.top + s0, bottom: r.bottom + s0, theme: el.dataset.theme };
    });
    labels.remeasure();
  }
  const rectAt = (sc, s) => {
    const b = sc.box;
    const top = b.pin ? b.pin.fixedTop + (b.pin.start - s) + clamp(s - b.pin.start, 0, b.pin.end - b.pin.start) : b.docTop - s;
    return { x: b.left, y: top, w: b.w, h: b.h };
  };
  const scrollPos = () => {
    const y = state.scroll?.y;
    return Number.isFinite(y) && (y > 0 || html.classList.contains('motion-on')) ? y : window.scrollY;
  };
  // which scene(s) the stage shows at scroll s
  function resolve(s) {
    if (!order.length) return null;
    let i = 0;
    while (i < order.length && s >= order[i].box.inS) i++;
    let a = null, b = null, u = 0;
    if (i === 0) a = order[0];
    else if (i === order.length) a = order[order.length - 1];
    else {
      const A = order[i - 1], B = order[i];
      if (s <= A.box.outS) a = A;
      else {
        u = (s - A.box.outS) / Math.max(1, B.box.inS - A.box.outS);
        if (A.model !== B.model && models[A.model] && models[B.model] && pairs[`${A.model}>${B.model}`]) { a = A; b = B; }
        else a = u < 0.5 ? A : B;
      }
    }
    if (b) return { a, b, m: clamp01((u - 0.1) / 0.8) };
    if (!models[a.model]) return null;
    const r = rectAt(a, s), m = Math.max(r.w, r.h) * (a.id === 'hero' ? 0.6 : 0.3);
    if (r.y + r.h + m < 0 || r.y - m > H || r.x + r.w + m < 0 || r.x - m > W) return null;
    return { a, b: null, m: 0 };
  }

  /* ── placing and posing ── */
  function place(rec, sc, s, k = 1) {
    const r = rectAt(sc, s);
    rec.cx = r.x + r.w / 2; rec.cy = r.y + r.h / 2;
    rec.holder.position.set((rec.cx / W - 0.5) * visW, (0.5 - rec.cy / H) * visH, 0);
    const px = Math.min(r.w, r.h) * 0.5 * sc.fit;
    rec.base = px / (rec.radius * pxPerUnit);
    rec.holder.scale.setScalar(rec.base * k);
    rec.pxR = px * k;
    rec.scene = sc.id;
  }
  function explode(rec, h) {
    let sum = 0;
    for (const q of rec.partList) {
      const o = seg(h, HX.out + q.out * HX.outSpread, HX.out + q.out * HX.outSpread + HX.outDur);
      const u = seg(h, HX.snap + q.snap * HX.snapSpread, HX.snap + q.snap * HX.snapSpread + HX.snapDur);
      const f = outQuart(o) * snapF(u);
      q.group.position.copy(q.rest).addScaledVector(q.offset, f);
      q.group.rotation.x = q.tilt * Math.max(0, f);
      if (q.internal) q.group.visible = f > 0.003;
      sum += Math.max(0, f);
    }
    return sum / rec.partList.length;
  }
  function heroProgress(sc, s) {
    if (typeof state.heroPin === 'number') return clamp01(state.heroPin);
    const p = sc.box.pin;
    return p ? clamp01((s - p.start) / Math.max(1, p.end - p.start)) : 0;
  }
  function tilt(rec, rx, ry, rz, gain = 1) {
    const t = clock;
    rec.pivot.rotation.set(rx + pv.y * 0.22 * gain + Math.sin(t * 0.63) * 0.025, ry + pv.x * 0.36 * gain + Math.sin(t * 0.41) * 0.04, rz + Math.sin(t * 0.7) * 0.02);
  }
  function poseController(rec, sc, s, dt) {
    let G = 0, power = 1;
    const ent = firstT < 0 ? 0 : outCubic(seg(clock - firstT, 0, 1.1));
    if (sc.id === 'hero') {
      heroH += (heroProgress(sc, s) - heroH) * damp(9, dt);
      if (Math.abs(heroProgress(sc, s) - heroH) < 1e-4) heroH = heroProgress(sc, s);
      const h = heroH;
      G = explode(rec, h);
      const k = inOutCubic(seg(h, ...HX.toE)) * (1 - inOutCubic(seg(h, ...HX.back)));
      const turn = 0.5 * inOutSine(seg(h, 0.28, 0.66));
      place(rec, sc, s, 1);
      const kE = Math.min(1, (Math.min(H * 0.42, W * 0.42) / (rec.exR * pxPerUnit)) / rec.base);
      const k2 = lerp(1, kE, G) * (0.88 + 0.12 * ent);
      rec.holder.scale.setScalar(rec.base * k2); rec.pxR *= k2;
      rec.pivot.position.set(0, -rec.centerY * G + Math.sin(clock * 1.1) * 0.03 * (1 - G), 0);
      tilt(rec, lerp(POSE.hero.x, POSE.explode.x, k), lerp(POSE.hero.y, POSE.explode.y + turn, k) - (1 - ent) * 0.7, POSE.hero.z * (1 - k), 1 - 0.6 * G);
      power = readyT === null ? 0.12 + 0.16 * (0.5 + 0.5 * Math.sin(clock * 2.1)) : Math.max(0.12, ignite(clock - readyT - 0.15));
      stats.h = h;
      if (G > 0.01 || rec.exploded) { rec.exploded = G > 0.01; }
      rec.holder.updateMatrixWorld(true);
      labels.update(rec.ds, camera, W, H, seg(h, ...HX.lab), seg(h, ...HX.labOut));
    } else {
      if (rec.exploded) { explode(rec, 0); rec.exploded = false; }
      const r = rectAt(sc, s);
      const u = clamp01((H - r.y) / (H + r.h));
      place(rec, sc, s);
      rec.pivot.position.set(0, Math.sin(clock * 1.1) * 0.03, 0);
      tilt(rec, POSE.ps5.x, POSE.ps5.y + (u - 0.5) * 1.3, POSE.ps5.z);
    }
    rec.power = power;
    return G;
  }
  function poseWheel(rec, sc, s, dt, presence) {
    place(rec, sc, s);
    const vel = Number(state.scroll?.velocity) || 0;
    const target = clamp(-vel * 0.05, -1.5, 1.5) * presence;
    const n = Math.max(1, Math.ceil(dt * 240)), h = dt / n;
    for (let i = 0; i < n; i++) {
      steerV += (70 * (target - steer) - 7.5 * steerV) * h; steer += steerV * h;
      for (const p of paddle) { p.v += (-220 * p.a - 16 * p.v) * h; p.a += p.v * h; }
    }
    if (Math.abs(vel) > 1.5) {
      const d = Math.sign(vel);
      if (d !== lastDir) { if (lastDir && presence > 0.5) paddle[d > 0 ? 1 : 0].v += 9; lastDir = d; }
    }
    if (rec.steer) rec.steer.rotation.z = steer;
    rec.paddles.forEach((g, i) => { if (g) g.rotation.y = (i ? -1 : 1) * paddle[i].a * 0.5; });
    rec.pivot.position.set(0, Math.sin(clock * 1.1) * 0.025, 0);
    tilt(rec, POSE.sim.x, POSE.sim.y, POSE.sim.z + (rec.steer ? 0 : steer), 0.8);
    rec.power = 0.35 + 0.65 * Math.min(1, Math.abs(vel) / 28);
  }
  function poseHeadset(rec, sc, s) {
    place(rec, sc, s);
    rec.pivot.position.set(0, Math.sin(clock * 0.9) * 0.035, 0);
    tilt(rec, POSE.vr.x, POSE.vr.y, POSE.vr.z, 1.35);
    rec.power = 0.75 + 0.25 * Math.sin(clock * 1.6);
  }
  function pose(rec, sc, s, dt, presence = 1) {
    if (rec.name === 'controller') return poseController(rec, sc, s, dt);
    if (rec.name === 'wheel') poseWheel(rec, sc, s, dt, presence);
    else poseHeadset(rec, sc, s);
    return 0;
  }
  function setPower(rec, p) {
    for (const m of rec.acc) m.emissiveIntensity = p * (rec.name === 'controller' ? 5.2 : 3.2);
    if (rec.glow) rec.glow.material.uniforms.uPow.value = Math.min(1.2, p);
  }
  function dissolve(rec, mode, level, axis) {
    rec.U.uDisMode.value = mode;
    rec.U.uDis.value = level;
    if (axis) rec.U.uDisAxis.value.copy(axis);
  }

  /* ── theme: how dark the page is behind the stage (drives the contact shadow, halo and label tone) ── */
  function readDark(s) {
    let L = null;
    if (html.classList.contains('motion-on')) {
      for (const el of [document.body, html]) {
        const m = getComputedStyle(el).backgroundColor.match(/rgba?\(([^)]+)\)/);
        if (!m) continue;
        const [r, g, b, a = 1] = m[1].split(/[\s,/]+/).filter(Boolean).map(Number);
        if (a < 0.5) continue;
        L = (0.2126 * r + 0.7152 * g + 0.0722 * b) / 255;
        break;
      }
    }
    if (L === null) {
      const c = s + H / 2, sec = sections.find((x) => c >= x.top && c < x.bottom);
      return sec ? (sec.theme === 'dark' ? 1 : sec.theme === 'sage' ? 0.45 : 0) : darkT;
    }
    return clamp01((0.62 - L) / 0.42);
  }

  /* ── one frame ── */
  function show(list) {
    for (const r of Object.values(models)) r.holder.visible = list.includes(r);
  }
  function frame(now) {
    raf = requestAnimationFrame(frame);
    const dt = lastNow ? Math.min(0.1, Math.max(0, (now - lastNow) / 1000)) : 1 / 60;
    const frameMs = lastNow ? now - lastNow : 0;
    lastNow = now;
    clock += dt;
    try { step(dt, frameMs); } catch (e) { fail(e); }
  }
  function step(dt, frameMs) {
    const s = scrollPos();
    if (Math.abs(s - lastS) > 0.5) { moving = true; still = 0; } else if (moving && ++still > 8) { moving = false; dirty = true; }
    lastS = s;
    if (dirty) measure();
    const v = resolve(s);
    if (!v) { setDrawing(false); labels.hide(); stats.mode = 'idle'; return; }
    // pointer (eased); touch gets a slow sway instead
    const tx = touch ? Math.sin(clock * 0.4) * 0.35 : clamp(Number(state.pointer?.nx) || 0, -1, 1);
    const ty = touch ? Math.sin(clock * 0.31) * 0.25 : clamp(Number(state.pointer?.ny) || 0, -1, 1);
    pv.x += (tx - pv.x) * damp(3.2, dt); pv.y += (ty - pv.y) * damp(3.2, dt);
    if (++darkTick % 6 === 0 || dirty) darkT = readDark(s);
    dark += (darkT - dark) * damp(5, dt);
    const tone = dark > 0.5 ? 'dark' : 'light';
    if (tone !== toneNow) { toneNow = tone; stage.dataset.tone = tone; }

    let solid = null, G = 0;
    const vr = models.headset;
    let portalOpen = 0;
    if (!v.b) {
      const rec = models[v.a.model];
      show([rec]);
      P.points.visible = false;
      G = pose(rec, v.a, s, dt, 1);
      dissolve(rec, 0, 0);
      setPower(rec, rec.power);
      solid = rec;
      if (v.a.id !== 'hero') labels.hide();
      // the portal belongs to the headset: it closes as the VR stage scrolls out of view (it follows the pointer, so it would
      // otherwise float over the next chapter while the headset is still within resolve()'s margin)
      if (v.a.id === 'vr') { const r = rectAt(v.a, s); portalOpen = clamp01(((Math.min(r.y + r.h, H) - Math.max(r.y, 0)) / Math.max(1, Math.min(r.h, H)) - 0.3) / 0.4); }
      stats.mode = v.a.id; stats.m = 0;
    } else {
      labels.hide();
      const A = models[v.a.model], B = models[v.b.model], pair = pairs[`${A.name}>${B.name}`];
      mS += (v.m - mS) * damp(12, dt);
      if (Math.abs(v.m - mS) < 1e-4) mS = v.m;
      const m = mS, D = MO.MORPH_D;
      pose(A, v.a, s, dt, 0);
      pose(B, v.b, s, dt, clamp01((m - 0.9) / 0.1));
      const la = clamp01(m / D), lb = clamp01((m - (1 - D)) / D);
      show([m < D ? A : null, m > 1 - D ? B : null].filter(Boolean));
      dissolve(A, m > 0 ? 1 : 0, la, pair.axA);
      dissolve(B, m < 1 ? 2 : 0, lb, pair.axB);
      setPower(A, A.power * (1 - la));
      setPower(B, B.power * lb);
      A.holder.updateMatrixWorld(true); B.holder.updateMatrixWorld(true);
      A.U.uDisInv.value.copy(A.ds.group.matrixWorld).invert();
      B.U.uDisInv.value.copy(B.ds.group.matrixWorld).invert();
      if (P.points.geometry !== pair.geo) P.points.geometry = pair.geo;
      P.points.visible = m > 0 && m < 1;
      P.u.uM.value = m;
      P.u.uA.value.copy(A.ds.group.matrixWorld);
      P.u.uB.value.copy(B.ds.group.matrixWorld);
      P.u.uTime.value = clock;
      P.u.uPx.value = 0.0125 * ((A.base + B.base) / 2) * (H * dpr()) / (2 * TAN);
      P.u.uOpacity.value = 0.9;
      solid = m < 0.5 ? (m < D ? A : null) : (m > 1 - D ? B : null);
      if (v.b.id === 'vr') portalOpen = lb * lb;
      stats.mode = `${v.a.id}>${v.b.id}`; stats.m = Math.round(m * 1000) / 1000;
    }

    /* contact shadow (paper) + halo (dark) under / behind the solid */
    const lb2 = solid ? (solid.U.uDisMode.value ? (solid.U.uDisMode.value === 1 ? 1 - solid.U.uDis.value : solid.U.uDis.value) : 1) : 0;
    if (solid) {
      const k = solid.pxR / pxPerUnit;
      shadow.mesh.visible = dark < 0.98;
      shadow.mesh.position.set(solid.holder.position.x, solid.holder.position.y - k * (1.02 + G * 0.25), -k);
      shadow.mesh.scale.set(k * 1.7 * (1 + G * 0.3), k * 0.2, 1);
      // fade as the model's centre leaves the viewport: the shadow sits a radius below it and would linger on screen alone
      const seen = clamp01(1 - Math.max(0, -solid.cy, solid.cy - H) / Math.max(1, solid.pxR * 0.5));
      shadow.material.uniforms.uOp.value = (1 - dark) * 0.36 * lb2 * (1 - 0.5 * G) * seen;
      halo.mesh.visible = dark > 0.02;
      halo.mesh.position.set(solid.holder.position.x, solid.holder.position.y, -k * 1.4);
      halo.mesh.scale.setScalar(k * 4.2);
      halo.material.uniforms.uPow.value = dark * lb2 * (0.25 + 0.5 * Math.min(1, solid.power));
    } else { shadow.mesh.visible = false; halo.mesh.visible = false; }

    /* light-bar spill lights follow the controller's bars */
    const c = models.controller;
    const spillOn = c && c.holder.visible && c.ds.anchors.lightBars;
    lights.spill.forEach((l, i) => {
      if (!spillOn) { l.intensity = 0; return; }
      const bar = c.ds.anchors.lightBars[i];
      l.position.copy(bar.mid).addScaledVector(bar.normal, 0.09).applyMatrix4(c.ds.parts.lightBars.group.matrixWorld);
      l.distance = 1.3 * c.holder.scale.x;
      l.intensity = 0.07 * Math.min(1.2, c.power) * c.holder.scale.x * c.holder.scale.x * (c.U.uDisMode.value === 1 ? 1 - c.U.uDis.value : 1);
    });

    /* VR portal */
    portalC.open += (portalOpen - portalC.open) * damp(portalOpen > portalC.open ? 3 : 6, dt);
    portal.mesh.visible = !!vr && portalC.open > 0.002;
    if (portal.mesh.visible) {
      const R = clamp(Math.min(W, H) * 0.17, 84, 190);
      let px, py;
      const ptr = state.pointer;
      if (!touch && !lite && ptr && (ptr.x || ptr.y)) { px = ptr.x; py = ptr.y; }
      else { const a = clock * 0.45; px = vr.cx + Math.cos(a) * vr.pxR * 1.25; py = vr.cy + Math.sin(a) * vr.pxR * 0.75; }
      if (portalC.x < 0) { portalC.x = px; portalC.y = py; }
      portalC.x += (px - portalC.x) * damp(7, dt); portalC.y += (py - portalC.y) * damp(7, dt);
      const d = dpr(), u = portal.u;
      u.uRes.value.set(W * d, H * d);
      u.uC.value.set(portalC.x * d, (H - portalC.y) * d);
      u.uR.value = R * d * outCubic(portalC.open);
      u.uOpen.value = portalC.open;
      u.uTime.value = lite ? 7.3 : clock;
      u.uLook.value.set((portalC.x / W) * 2 - 1, 1 - (portalC.y / H) * 2);
    }

    render();
    setDrawing(true);
    if (firstT < 0) firstFrame();
    if (frameMs > 0) { FT[ftI] = frameMs; ftI = (ftI + 1) % FT.length; ftN = Math.min(FT.length, ftN + 1); perfGuard(frameMs); }
  }
  function render() {
    renderer.render(scene, camera);
    const ri = renderer.info.render;
    stats.calls = ri.calls; stats.triangles = ri.triangles; stats.points = ri.points;
    if (ri.calls > stats.peakCalls) stats.peakCalls = ri.calls;
    if (ri.triangles > stats.peakTriangles) stats.peakTriangles = ri.triangles;
  }
  function setDrawing(v) {
    if (v === drawing) return;
    drawing = v;
    canvas.style.visibility = v ? '' : 'hidden';
    guard.n = 0; guard.warm = 0; lastNow = 0;
  }
  function firstFrame() {
    firstT = clock;
    stats.firstFrameMs = Math.round(performance.now());
    stats.firstFrameSinceInitMs = Math.round(performance.now() - T0);
    html.classList.add('gl-on');
    if (readyEmitted) return;
    readyEmitted = true;
    progress(1);
    bus.emit('gl:ready', { tier });
  }

  /* ── perf guard: p90 frame time over 120 drawn frames; step quality down, give up if hopeless ── */
  function perfGuard(ms) {
    if (++guard.warm < 30) return;
    guard.buf[guard.i] = ms; guard.i = (guard.i + 1) % 120;
    if (++guard.n < 120) return;
    guard.n = 0;
    const p90 = Float32Array.from(guard.buf).sort()[107];
    if (p90 < 24) return;
    guard.level++;
    stats.level = guard.level;
    console.info(`[gl] slow frames (p90 ${p90.toFixed(1)} ms): quality step ${guard.level}`);
    if (guard.level === 1) dprScale = 0.75;
    else if (guard.level === 2) { for (const p of Object.values(pairs)) p.geo.setDrawRange(0, Math.floor(COUNT / 2)); }
    else if (guard.level === 3) dprScale = 0.5;
    else { fail(new Error('frame rate too low')); return; }
    applySize();
  }

  /* ── lifecycle ── */
  function onResize() { applySize(); dirty = true; }
  function onVis() {
    if (document.hidden) { cancelAnimationFrame(raf); raf = 0; }
    else if (!raf && !lost && !disposed) { lastNow = 0; raf = requestAnimationFrame(frame); }
  }
  function onLost(e) {
    e.preventDefault();
    lost = true;
    cancelAnimationFrame(raf); raf = 0;
    html.classList.remove('gl-on');
    labels.hide();
  }
  function onRestored() {
    if (disposed) return;
    lost = false;
    try { env.rebuild(); } catch (e) { fail(e); return; }
    firstT = -1; drawing = true; setDrawing(false); dirty = true;
    if (!document.hidden) { lastNow = 0; raf = requestAnimationFrame(frame); }
  }
  function release() {
    try {
      for (const r of Object.values(models)) { r.glow?.dispose(); r.ds.dispose?.(); }
      for (const p of Object.values(pairs)) p.geo.dispose();
      P.points.geometry.dispose(); P.material.dispose();
      shadow.dispose(); halo.dispose(); portal.dispose(); env.dispose();
      scene.clear();
      renderer.dispose();
      renderer.forceContextLoss();
    } catch (e) { console.warn('[gl] dispose', e); }
  }
  function dispose() {
    if (disposed) return;
    disposed = true;
    cancelAnimationFrame(raf); raf = 0;
    for (const f of offs.splice(0)) { try { f(); } catch { /* ignore */ } }
    html.classList.remove('gl-on');
    labels.dispose();
    if (compiling) compiling.then(release, release); else release();
    stage.remove();
    if (window.__mxgl && window.__mxgl.dispose === dispose) delete window.__mxgl;
    instance = null;
  }
  function fail(e) {
    if (disposed) return;
    console.warn('[gl] stage stopped:', e && e.message ? e.message : e);
    dispose();
  }

  on(window, 'resize', onResize);
  on(document, 'visibilitychange', onVis);
  on(canvas, 'webglcontextlost', onLost);
  on(canvas, 'webglcontextrestored', onRestored);
  const markReady = () => { if (readyT === null) readyT = clock; dirty = true; };
  offs.push(bus.on('ready', markReady), bus.on('gate:start', markReady), bus.on('chapter', () => { dirty = true; }));
  if (typeof ResizeObserver === 'function') {
    const ro = new ResizeObserver(() => { dirty = true; });
    ro.observe(document.body);
    offs.push(() => ro.disconnect());
  }
  document.fonts?.ready?.then(() => { dirty = true; });

  /* ── compile, then the first frame; the other models load behind it ── */
  compiling = renderer.compileAsync(scene, camera);
  await compiling.catch(() => {});
  compiling = null;
  if (disposed) return { dispose() {}, stats: () => null };
  progress(0.92);
  stats.dpr = dpr();
  raf = document.hidden ? 0 : requestAnimationFrame(frame);
  loadRest();

  async function loadRest() {
    const idle = () => new Promise((r) => (window.requestIdleCallback ? requestIdleCallback(() => r(), { timeout: 300 }) : setTimeout(r, 30)));
    try {
      for (const name of ['wheel', 'headset']) {
        await idle();
        if (disposed) return;
        const rec = addModel(name, await S.loadModel(THREE, name));
        if (rec.ds.placeholder) stats.placeholders.push(name);
        compiling = renderer.compileAsync(rec.holder, camera, scene);
        await compiling.catch(() => {});
        compiling = null;
        if (disposed) return;
      }
      for (const name of ['controller', 'wheel', 'headset']) { await idle(); if (disposed) return; sample(models[name]); }
      await idle(); if (disposed) return;
      buildPair('controller', 'ps5', 'wheel', 'sim');
      await idle(); if (disposed) return;
      buildPair('wheel', 'sim', 'headset', 'vr');
      stats.restMs = Math.round(performance.now() - T0);
      dirty = true;
    } catch (e) { console.warn('[gl] could not load the other models', e); }
  }

  const handle = {
    dispose,
    stats: () => ({ ...stats, dpr: dpr(), drawing, frames: frameStats() }),
  };
  function frameStats() {
    const a = Array.from(FT.subarray(0, ftN)).sort((x, y) => x - y);
    const q = (p) => (a.length ? Math.round(a[Math.min(a.length - 1, Math.floor(a.length * p))] * 10) / 10 : 0);
    return { n: a.length, avg: a.length ? Math.round((a.reduce((x, y) => x + y, 0) / a.length) * 10) / 10 : 0, p50: q(0.5), p95: q(0.95), max: q(1) };
  }
  if (debug) {
    window.__mxgl = Object.assign(handle, {
      resetFrames() { ftN = 0; ftI = 0; stats.peakCalls = 0; stats.peakTriangles = 0; },
      lose() { loseExt?.loseContext(); }, restore() { loseExt?.restoreContext(); },
      THREE, scene, camera, renderer, models, get layout() { return order.map((sc) => ({ id: sc.id, ...sc.box })); },
    });
  }
  return handle;
}
