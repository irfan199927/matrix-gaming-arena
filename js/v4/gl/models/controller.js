/* ═══════════════════════════════════════════════════════════════
   Procedural two-tone game-pad, DualSense-style silhouette (V4 copy of js/intro/dualsense.js, owned by the WebGL stage).
   Modelled in millimetres from reference proportions (≈160 × 66 × 106 mm),
   baked to world units (1 unit = 100 mm) and centred on the origin.
   No logos, no button glyphs, no trademarks of any kind.

   Every part is its own group so it can be exploded; simplified internals (mainboard, battery,
   haptic actuators, trigger motors, speaker) sit inside and are only seen when exploded.

   createDualSense(THREE, { accent }) → {
     group, materials[], lightBarMaterial, meshes{name},
     parts{name: { group, mesh, material, rest, offset, out, snap, tilt, internal }},
     anchors: { lightBars:[{a,b,mid,normal}] (lightBars-part local), touchpad:{center,normal},
                radius, box, exploded (Box3), labels{id: { part, p }} (part local) },
     stats, dispose()
   }
   ═══════════════════════════════════════════════════════════════ */

const MM = 0.01;

/* ── tuning ─────────────────────────────────────────────────── */
const EDGE_R = 7.2;        // horizontal edge radius of the shell (mm)
const EDGE_RV = 8.2;       // vertical edge radius of the shell (mm)
const SEAM_R = 3.0;        // radius of the white wing lip over the black face
const WING_LIFT = 1.7;     // how far the white wings stand proud of the black face
const BEND = { z0: 2, yc: -2, kmax: 1 / 34, ramp: 18, fadeA: 30, fadeB: 58, fade: 0.6 };

const smooth = (e0, e1, x) => {
  const t = Math.min(1, Math.max(0, (x - e0) / (e1 - e0)));
  return t * t * (3 - 2 * t);
};

/* core shell heights before deformation */
const TOP = (x, z) => 12 + 1.5 * smooth(-20, -52, z);
const BOT = (x, z) => -16 + 2.2 * smooth(-30, -56, z) - 5.5 * smooth(36, 64, Math.abs(x)) * smooth(-10, 40, z);

/* touchpad: slightly proud at the back, curving down toward the player */
const TP_TOP = (x, z) => TOP(x, z) + 2.0 - 0.00115 * (z + 53.8) * (z + 53.8);

/* ── outlines (top view, x = right, z = toward the player) ──── */
// Right half of the full body outline, from the top edge clockwise to the U between the grips.
const BODY_R = [
  [18, -53.4], [33, -53.6], [42, -54.2], [50, -54.0], [57, -52.4], [62.6, -49.8],
  [67.4, -46.2], [71.4, -41.6], [74.5, -36], [76.8, -29.4], [78.4, -21.6], [79.5, -12], [80.1, -1],
  [80.2, 10], [79.6, 21], [78.1, 32], [75.6, 42.5], [72.2, 51.5], [67.9, 58.6], [62.9, 62.6], [57.6, 63.2],
  [53.3, 60], [50.6, 54], [48.8, 46.5], [47.1, 38.6], [45.2, 31.6], [42.2, 26.2], [36.8, 22.4], [28, 20.2], [14, 19.2]
];
// grips: the flat outline is a little shorter than its bent projection, so compress beyond z = 18
const GRIP = ([x, z]) => [x, z > 18 ? 18 + (z - 18) * 0.84 : z];
const BODY = [[0, -53.4], ...BODY_R.map(GRIP), [0, 19.0], ...BODY_R.slice().reverse().map(GRIP).map(([x, z]) => [-x, z])];

// Right wing: shares the outer run of the body outline, then returns along the seam.
const WING_OUTER_FROM = 2, WING_OUTER_TO = 23; // indices into BODY_R (runs round the grip end)
const WING_R = [
  [[38.4, -54.4], 'i'],
  ...BODY_R.slice(WING_OUTER_FROM, WING_OUTER_TO).map((p) => [p, 'o']), // raw: GRIP is applied once, at sampling
  // seam leaves the grip's inner edge just above the tip and sweeps up the grip; the black band
  // therefore ends in a smooth curve while the white shell wraps the whole rounded grip end
  [[52.0, 50.6], 's'], [[54.8, 48.6], 's'], [[57.9, 46.0], 's'], [[60.3, 42.0], 's'], [[61.2, 36.4], 's'], [[60.4, 31.6], 's'],
  [[57.6, 23], 's'], [[55.0, 15.8], 's'], [[51.8, 9.2], 's'], [[48.0, 3.2], 's'], [[43.8, -2.4], 's'],
  [[39.8, -7.8], 's'], [[36.6, -13.4], 's'], [[35.2, -19.6], 'i'], [[35.6, -27.5], 'i'],
  [[36.5, -37.5], 'i'], [[37.4, -47], 'i'],
];

// Touchpad (rounded trapezoid, narrower toward the player)
const TOUCHPAD = [
  [0, -53.9], [20, -53.9], [31.6, -53.8], [33.9, -52.8], [34.4, -50], [33.8, -41], [32.9, -32],
  [32.0, -25], [30.6, -21.2], [27.6, -19.4], [20, -18.7], [0, -18.5],
  [-20, -18.7], [-27.6, -19.4], [-30.6, -21.2], [-32.0, -25], [-32.9, -32], [-33.8, -41], [-34.4, -50],
  [-33.9, -52.8], [-31.6, -53.8], [-20, -53.9],
];
// Light bar centre-lines (right side; mirrored for the left)
const BAR_A = [35.75, -50.6], BAR_B = [33.55, -24.2], BAR_HALF_W = 1.05;

// L1 / R1 bumper crescent (right side)
const BUMPER_R = [
  [44, -57.6], [51, -57.6], [58.4, -55.9], [64.6, -52.9], [69.6, -48.6], [72.6, -44.4],
  [70.2, -43.2], [66.4, -46.8], [61, -50.2], [55, -52.4], [49, -53.4], [44, -53.6],
];

/* ── exploded view ──────────────────────────────────────────────
   per part: offset (x, y, z in world units, model space) at full explode, explode delay (s),
   reassembly delay (s) and an optional pitch (rad) while apart. Layers lift and spread:
   caps on top, then touchpad / light bars, the top shell, the internals, the back shell below. */
const EXPLODE = {
  stickL: [-0.03, 0.9, 0.02, 0, 0.34], stickR: [0.03, 0.9, 0.02, 0.02, 0.35],
  dpad: [-0.05, 0.8, 0, 0.03, 0.31], face: [0.05, 0.8, 0, 0.05, 0.32], center: [0, 0.76, 0.03, 0.04, 0.3],
  L1: [-0.12, 0.52, -0.3, 0.07, 0.27], R1: [0.12, 0.52, -0.3, 0.08, 0.27],
  touchpad: [0, 0.64, -0.02, 0.08, 0.24], lightBars: [0, 0.54, -0.02, 0.1, 0.22],
  shellTop: [0, 0.42, 0, 0.12, 0.16],
  L2: [-0.26, 0.22, -0.34, 0.12, 0.2, 0.4], R2: [0.26, 0.22, -0.34, 0.13, 0.2, 0.4],
  shellBack: [0, -0.56, 0, 0.14, 0.1],
  pcb: [0, 0.06, 0, 0.16, 0.05], speaker: [0, -0.1, 0.22, 0.2, 0.04],
  motorL: [-0.2, 0.12, -0.18, 0.18, 0.06], motorR: [0.2, 0.12, -0.18, 0.19, 0.06],
  hapticL: [-0.22, -0.08, 0.14, 0.2, 0.02], hapticR: [0.22, -0.08, 0.14, 0.21, 0.03],
  battery: [0, -0.27, 0, 0.22, 0],
};

/* ── main factory ───────────────────────────────────────────── */
export function createDualSense(THREE, opts = {}) {
  const t0 = performance.now();
  const accent = new THREE.Color(opts.accent || '#38f24a');
  const V3 = THREE.Vector3;

  /* ---------- deformation: wing droop + grip bend ---------- */
  const STEP = 0.25, SMAX = 160;
  const tab = [];
  {
    let cz = BEND.z0, cy = BEND.yc, phi = 0;
    for (let s = 0; s <= SMAX + 1e-6; s += STEP) {
      tab.push(cz, cy, phi);
      const k = BEND.kmax * smooth(0, BEND.ramp, s) * (1 - BEND.fade * smooth(BEND.fadeA, BEND.fadeB, s));
      const mid = phi + 0.5 * k * STEP;
      cz += Math.cos(mid) * STEP;
      cy -= Math.sin(mid) * STEP;
      phi += k * STEP;
    }
  }
  const tabN = tab.length / 3;
  const droop = (x) => { const t = smooth(46, 84, Math.abs(x)); return 3.4 * t * t; };

  function deform(x, y, z, out) {
    y -= droop(x);
    if (z <= BEND.z0) return out.set(x, y, z);
    const f = (z - BEND.z0) / STEP;
    let i = Math.floor(f);
    if (i >= tabN - 1) i = tabN - 2;
    const t = f - i, a = i * 3, b = a + 3;
    const cz = tab[a] + (tab[b] - tab[a]) * t;
    const cy = tab[a + 1] + (tab[b + 1] - tab[a + 1]) * t;
    const ph = tab[a + 2] + (tab[b + 2] - tab[a + 2]) * t;
    const h = y - BEND.yc;
    return out.set(x, cy + h * Math.cos(ph), cz + h * Math.sin(ph));
  }
  const _d = new V3();
  function deformGeometry(g) {
    const a = g.attributes.position.array;
    for (let i = 0; i < a.length; i += 3) {
      deform(a[i], a[i + 1], a[i + 2], _d);
      a[i] = _d.x; a[i + 1] = _d.y; a[i + 2] = _d.z;
    }
    return g;
  }

  /* frame (position + orientation) on a deformed surface y = surf(x, z) */
  function frameAt(x, z, surf, lift = 0, yaw = 0) {
    const e = 0.5;
    const p = deform(x, surf(x, z), z, new V3());
    const px = deform(x + e, surf(x + e, z), z, new V3()).sub(p).normalize();
    const pz = deform(x, surf(x, z + e), z + e, new V3()).sub(p).normalize();
    const n = new V3().crossVectors(pz, px).normalize();
    const tz = new V3().crossVectors(px, n).normalize();
    const m = new THREE.Matrix4().makeBasis(px, n, tz);
    if (yaw) m.multiply(new THREE.Matrix4().makeRotationY(yaw));
    p.addScaledVector(n, lift);
    m.setPosition(p);
    return m;
  }

  /* ---------- outline helpers ---------- */
  function sampleClosed(ctrl, n) {
    const curve = new THREE.CatmullRomCurve3(ctrl.map(([x, z]) => new V3(x, 0, z)), true, 'centripetal');
    curve.arcLengthDivisions = n * 6;
    const pts = curve.getSpacedPoints(n);
    pts.pop();
    return pts.map((p) => [p.x, p.z]);
  }
  function tagRadii(samples, ctrl, radiusFor, smoothN = 6) {
    const raw = samples.map(([x, z]) => {
      let best = Infinity, tag = 'o';
      for (const [p, tg] of ctrl) {
        const [cx, cz] = GRIP(p);
        const d = (cx - x) ** 2 + (cz - z) ** 2;
        if (d < best) { best = d; tag = tg; }
      }
      return radiusFor(tag);
    });
    const n = raw.length, out = new Array(n);
    for (let i = 0; i < n; i++) {
      let s = 0;
      for (let k = -smoothN; k <= smoothN; k++) s += raw[(i + k + n) % n];
      out[i] = s / (2 * smoothN + 1);
    }
    return out;
  }
  function capsule([ax, az], [bx, bz], r, segs = 14) {
    const dx = bx - ax, dz = bz - az, L = Math.hypot(dx, dz);
    const ux = dx / L, uz = dz / L, ang = Math.atan2(uz, ux);
    const pts = [];
    for (let i = 0; i <= segs; i++) {
      const a = ang - Math.PI / 2 + (i / segs) * Math.PI;
      pts.push([bx + Math.cos(a) * r, bz + Math.sin(a) * r]);
    }
    for (let i = 0; i <= segs; i++) {
      const a = ang + Math.PI / 2 + (i / segs) * Math.PI;
      pts.push([ax + Math.cos(a) * r, az + Math.sin(a) * r]);
    }
    return pts;
  }

  /* ---------- "pillow" extrusion: rounded slab with a densely tessellated cap ----------
     Like ExtrudeGeometry with a quarter-round bevel, but the lids get interior Steiner
     points so the shape can be bent and domed without faceting. */
  function pillow({ outline, rh, rv, top, bot, seg = 8, grid = 5, offset = 0 }) {
    let pts = outline;
    let rhs = typeof rh === 'number' ? new Array(pts.length).fill(rh) : rh;
    let area = 0;
    for (let i = 0, n = pts.length; i < n; i++) {
      const a = pts[i], b = pts[(i + 1) % n];
      area += a[0] * b[1] - b[0] * a[1];
    }
    if (area < 0) { pts = pts.slice().reverse(); rhs = rhs.slice().reverse(); }
    const N = pts.length;
    const nx = new Float64Array(N), nz = new Float64Array(N);
    for (let i = 0; i < N; i++) {
      const p0 = pts[(i - 1 + N) % N], p1 = pts[i], p2 = pts[(i + 1) % N];
      let ax = p1[0] - p0[0], az = p1[1] - p0[1];
      const la = Math.hypot(ax, az) || 1; ax /= la; az /= la;
      let bx = p2[0] - p1[0], bz = p2[1] - p1[1];
      const lb = Math.hypot(bx, bz) || 1; bx /= lb; bz /= lb;
      let mx = az + bz, mz = -ax - bx;
      const lm = Math.hypot(mx, mz) || 1; mx /= lm; mz /= lm;
      const c = Math.max(0.45, mx * az - mz * ax);
      nx[i] = mx / c; nz[i] = mz / c;
    }
    // keep every inset ring inside the local width so lids never fold (narrow tips, capsule ends)
    rhs = rhs.slice();
    // segment bounding circles: a hit farther than `reach` cannot lower the radius, so skip those
    const scx = new Float64Array(N), scz = new Float64Array(N), sr = new Float64Array(N);
    for (let j = 0; j < N; j++) {
      const a = pts[j], b = pts[(j + 1) % N];
      scx[j] = (a[0] + b[0]) / 2; scz[j] = (a[1] + b[1]) / 2;
      sr[j] = Math.hypot(b[0] - a[0], b[1] - a[1]) / 2;
    }
    for (let i = 0; i < N; i++) {
      const ml = Math.hypot(nx[i], nz[i]);
      const dx = -nx[i] / ml, dz = -nz[i] / ml;
      const px = pts[i][0], pz = pts[i][1];
      const reach = (rhs[i] * ml) / 0.42;
      let hit = Infinity;
      for (let j = 0; j < N; j++) {
        if (j === i || j === (i - 1 + N) % N) continue;
        if (Math.hypot(scx[j] - px, scz[j] - pz) - sr[j] > reach) continue;
        const t = rayHit(px, pz, dx, dz, pts[j], pts[(j + 1) % N]);
        if (t > 0 && t < hit) hit = t;
      }
      if (hit < Infinity) rhs[i] = Math.min(rhs[i], (0.42 * hit) / ml);
    }
    {
      // relax the radii under their limits so the edge profile never changes abruptly (no lip steps)
      const lim = rhs.slice();
      for (let it = 0; it < 4; it++) {
        const cur = rhs.slice();
        for (let i = 0; i < N; i++) {
          let s = 0;
          for (let k = -5; k <= 5; k++) s += cur[(i + k + N) % N];
          rhs[i] = Math.min(lim[i], s / 11);
        }
      }
    }
    const rows = [];
    for (let j = seg; j >= 0; j--) { const th = (j / seg) * Math.PI / 2; rows.push([1 - Math.cos(th), -1, 1 - Math.sin(th)]); }
    for (let j = 0; j <= seg; j++) { const th = (j / seg) * Math.PI / 2; rows.push([1 - Math.cos(th), 1, 1 - Math.sin(th)]); }
    const R = rows.length;
    const pos = [];
    for (let r = 0; r < R; r++) {
      const [k, side, e] = rows[r];
      for (let i = 0; i < N; i++) {
        const ins = k * rhs[i] - offset;
        const x = pts[i][0] - nx[i] * ins, z = pts[i][1] - nz[i] * ins;
        pos.push(x, side > 0 ? top(x, z) - rv * e : bot(x, z) + rv * e, z);
      }
    }
    // lid polygon = innermost ring
    const cap = [];
    for (let i = 0; i < N; i++) { const b = ((R - 1) * N + i) * 3; cap.push([pos[b], pos[b + 2]]); }
    let minX = Infinity, maxX = -Infinity, minZ = Infinity, maxZ = -Infinity;
    for (const [x, z] of cap) { minX = Math.min(minX, x); maxX = Math.max(maxX, x); minZ = Math.min(minZ, z); maxZ = Math.max(maxZ, z); }
    const steiner = [];
    const capTest = polyIndex(cap, grid * 0.6);
    let row = 0;
    for (let gz = minZ + grid * 0.5; gz < maxZ; gz += grid * 0.866, row++) {
      for (let gx0 = minX + grid * (row % 2 ? 0.5 : 1); gx0 < maxX; gx0 += grid) {
        // deterministic jitter: collinear Steiner rows make earcut emit slivers and overlaps
        const h = Math.sin(gx0 * 12.9898 + gz * 78.233) * 43758.5453;
        const j1 = h - Math.floor(h), j2 = (h * 7.13) - Math.floor(h * 7.13);
        const gx = gx0 + (j1 - 0.5) * grid * 0.36, gzj = gz + (j2 - 0.5) * grid * 0.36;
        if (!capTest.inside(gx, gzj)) continue;
        if (capTest.near(gx, gzj, grid * 0.6)) continue;
        steiner.push([gx, gzj]);
      }
    }
    const faces = THREE.ShapeUtils.triangulateShape(
      cap.map(([x, z]) => new THREE.Vector2(x, z)),
      steiner.map(([x, z]) => [new THREE.Vector2(x, z)])
    );
    // earcut bridges Steiner points to the rim and leaves slivers; flip to a Delaunay-quality mesh
    const P2 = cap.concat(steiner);
    const tris = [];
    for (const [u, v, w] of faces) {
      const A = P2[u], B = P2[v], C = P2[w];
      const ar = (B[0] - A[0]) * (C[1] - A[1]) - (B[1] - A[1]) * (C[0] - A[0]);
      if (ar > 1e-10) tris.push([u, v, w]); else if (ar < -1e-10) tris.push([u, w, v]);
    }
    delaunayFlip(P2, tris);
    const topBase = pos.length / 3;
    for (const [x, z] of steiner) pos.push(x, top(x, z), z);
    const botBase = pos.length / 3;
    for (const [x, z] of steiner) pos.push(x, bot(x, z), z);

    const index = [];
    for (let r = 0; r < R - 1; r++) {
      for (let i = 0; i < N; i++) {
        const i1 = (i + 1) % N;
        const a = r * N + i, b = r * N + i1, c = (r + 1) * N + i1, d = (r + 1) * N + i;
        index.push(a, c, b, a, d, c);
      }
    }
    const topIdx = (v) => (v < N ? (R - 1) * N + v : topBase + v - N);
    const botIdx = (v) => (v < N ? v : botBase + v - N);
    // tris are CCW in (x, z), i.e. facing −y: reverse them for the top lid
    for (const [u, v, w] of tris) {
      index.push(topIdx(u), topIdx(w), topIdx(v));
      index.push(botIdx(u), botIdx(v), botIdx(w));
    }
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
    g.setIndex(index);

    const outer = pts.map((p, i) => [p[0] + nx[i] * offset, p[1] + nz[i] * offset]);
    function topAt(x, z) {
      let best = Infinity, bi = 0;
      for (let i = 0; i < N; i++) {
        const d = segDist(x, z, outer[i], outer[(i + 1) % N]);
        if (d < best) { best = d; bi = i; }
      }
      const r = rhs[bi];
      if (best >= r) return top(x, z);
      const c = 1 - best / r;
      return top(x, z) - rv * (1 - Math.sqrt(Math.max(0, 1 - c * c)));
    }
    return { geometry: g, topAt, outer, rhs, rv, top, bot };
  }

  /* Keep a shell (the white wings) inside an offset envelope of another pillow (the black core):
     any vertex that pokes past the core's rounded edges is projected back onto the envelope, so
     the white wraps the core's rounded grip ends instead of overhanging them. Flat coordinates. */
  function clampToEnvelope(geom, core, m, lift, mb, zMin = -Infinity, zMax = Infinity) {
    const O = core.outer, Rh = core.rhs, n = O.length, rv = core.rv;
    const CELL = 10, cells = new Map();
    const ck = (i, j) => (i + 200) * 1000 + (j + 200);
    for (let k = 0; k < n; k++) {
      const a = O[k], b = O[(k + 1) % n];
      const i0 = Math.floor(Math.min(a[0], b[0]) / CELL), i1 = Math.floor(Math.max(a[0], b[0]) / CELL);
      const j0 = Math.floor(Math.min(a[1], b[1]) / CELL), j1 = Math.floor(Math.max(a[1], b[1]) / CELL);
      for (let i = i0; i <= i1; i++) for (let j = j0; j <= j1; j++) {
        const key = ck(i, j);
        let l = cells.get(key);
        if (!l) cells.set(key, (l = []));
        l.push(k);
      }
    }
    const p = geom.attributes.position.array;
    for (let v = 0; v < p.length; v += 3) {
      let x = p[v], y = p[v + 1], z = p[v + 2];
      if (z > zMin && z < zMax) continue; // only the wing ends meet the core's rim
      const ci = Math.floor(x / CELL), cj = Math.floor(z / CELL);
      let best = Infinity, bs = -1, bt = 0;
      for (let di = -1; di <= 1; di++) for (let dj = -1; dj <= 1; dj++) {
        const l = cells.get(ck(ci + di, cj + dj));
        if (!l) continue;
        for (const k of l) {
          const a = O[k], b = O[(k + 1) % n];
          const dx = b[0] - a[0], dz = b[1] - a[1], l2 = dx * dx + dz * dz || 1;
          let t = ((x - a[0]) * dx + (z - a[1]) * dz) / l2;
          t = t < 0 ? 0 : t > 1 ? 1 : t;
          const d = Math.hypot(x - a[0] - dx * t, z - a[1] - dz * t);
          if (d < best) { best = d; bs = k; bt = t; }
        }
      }
      if (bs < 0) continue; // more than a cell away from the core rim: deep inside, untouched
      const a = O[bs], b = O[(bs + 1) % n];
      const dx = b[0] - a[0], dz = b[1] - a[1];
      const inside = dx * (z - a[1]) - dz * (x - a[0]) >= 0; // outlines are CCW: interior on the left
      let s2 = (inside ? best : -best) + m;
      if (s2 < 0) {
        const L = Math.hypot(dx, dz) || 1;
        x += (dz / L) * s2; z += (-dx / L) * s2; // pull back onto the envelope rim
        s2 = 0;
      }
      const re = Rh[bs] + (Rh[(bs + 1) % n] - Rh[bs]) * bt + m;
      const q = (re - s2) / re;
      const k = q > 0 ? Math.sqrt(Math.max(0, 1 - q * q)) : 1;
      const top = core.top(x, z) - rv + (rv + lift) * k;
      const bot = core.bot(x, z) + rv - (rv + mb) * k;
      p[v] = x; p[v + 1] = y > top ? top : y < bot ? bot : y; p[v + 2] = z;
    }
    return geom;
  }

  /* ---------- small geometry utilities ---------- */
  // merge coincident vertices (0.01 mm grid, numeric keys) so normals come out smooth
  function weld(g) {
    const a = g.attributes.position.array;
    const src = g.index ? g.index.array : null;
    const count = src ? src.length : a.length / 3;
    const map = new Map(), verts = [], index = new Uint32Array(count);
    for (let k = 0; k < count; k++) {
      const i = (src ? src[k] : k) * 3;
      const x = a[i], y = a[i + 1], z = a[i + 2];
      const key = ((Math.round(x * 100) + 16384) * 32768 + (Math.round(y * 100) + 16384)) * 32768 + (Math.round(z * 100) + 16384);
      let id = map.get(key);
      if (id === undefined) { id = verts.length / 3; map.set(key, id); verts.push(x, y, z); }
      index[k] = id;
    }
    const out = new THREE.BufferGeometry();
    out.setAttribute('position', new THREE.Float32BufferAttribute(verts, 3));
    out.setIndex(new THREE.BufferAttribute(index, 1));
    return out;
  }
  function finish(g) { const w = weld(g); g.dispose(); w.computeVertexNormals(); return w; }
  // apply an orthonormal frame to positions + normals without per-vertex object churn
  function place(g, m) {
    const e = m.elements, p = g.attributes.position.array, n = g.attributes.normal.array;
    for (let i = 0; i < p.length; i += 3) {
      const x = p[i], y = p[i + 1], z = p[i + 2];
      p[i] = e[0] * x + e[4] * y + e[8] * z + e[12];
      p[i + 1] = e[1] * x + e[5] * y + e[9] * z + e[13];
      p[i + 2] = e[2] * x + e[6] * y + e[10] * z + e[14];
      const u = n[i], v = n[i + 1], w = n[i + 2];
      n[i] = e[0] * u + e[4] * v + e[8] * w;
      n[i + 1] = e[1] * u + e[5] * v + e[9] * w;
      n[i + 2] = e[2] * u + e[6] * v + e[10] * w;
    }
    return g;
  }

  function merge(list) {
    let vCount = 0, iCount = 0;
    for (const g of list) { vCount += g.attributes.position.count; iCount += g.index ? g.index.count : g.attributes.position.count; }
    const pos = new Float32Array(vCount * 3), nor = new Float32Array(vCount * 3);
    const uvs = list[0].attributes.uv ? new Float32Array(vCount * 2) : null; // internals sample a colour atlas
    const idx = vCount > 65535 ? new Uint32Array(iCount) : new Uint16Array(iCount);
    let vo = 0, io = 0;
    for (const g of list) {
      const p = g.attributes.position, n = g.attributes.normal;
      pos.set(p.array.subarray(0, p.count * 3), vo * 3);
      nor.set(n.array.subarray(0, p.count * 3), vo * 3);
      if (uvs) uvs.set(g.attributes.uv.array.subarray(0, p.count * 2), vo * 2);
      if (g.index) { const a = g.index.array; for (let i = 0; i < a.length; i++) idx[io + i] = a[i] + vo; io += a.length; }
      else { for (let i = 0; i < p.count; i++) idx[io + i] = vo + i; io += p.count; }
      vo += p.count;
      g.dispose();
    }
    const out = new THREE.BufferGeometry();
    out.setAttribute('position', new THREE.BufferAttribute(pos, 3));
    out.setAttribute('normal', new THREE.BufferAttribute(nor, 3));
    if (uvs) out.setAttribute('uv', new THREE.BufferAttribute(uvs, 2));
    out.setIndex(new THREE.BufferAttribute(idx, 1));
    return out;
  }
  function lathe(profile, segs) {
    const g = new THREE.LatheGeometry(profile.map(([r, y]) => new THREE.Vector2(r, y)), segs);
    g.deleteAttribute('uv');
    return g;
  }
  function latheBare(profile, segs) { const g = lathe(profile, segs); g.deleteAttribute('normal'); return g; }
  function extrudeXZ(shape, depth, bevelT, bevelS) {
    const g = new THREE.ExtrudeGeometry(shape, {
      depth, bevelEnabled: true, bevelThickness: bevelT, bevelSize: bevelS,
      bevelSegments: 6, curveSegments: 24, steps: 1,
    });
    g.deleteAttribute('uv');
    g.deleteAttribute('normal');
    g.clearGroups();
    g.rotateX(-Math.PI / 2); // shape (x, y) → (x, -z); extrusion → +y
    return g;
  }
  function roundedPoly(shape, pts, r) {
    const n = pts.length;
    for (let i = 0; i < n; i++) {
      const p0 = pts[(i - 1 + n) % n], p1 = pts[i], p2 = pts[(i + 1) % n];
      const rr = Array.isArray(r) ? r[i] : r;
      const v1 = [p0[0] - p1[0], p0[1] - p1[1]], v2 = [p2[0] - p1[0], p2[1] - p1[1]];
      const l1 = Math.hypot(...v1), l2 = Math.hypot(...v2);
      const a = [p1[0] + (v1[0] / l1) * rr, p1[1] + (v1[1] / l1) * rr];
      const b = [p1[0] + (v2[0] / l2) * rr, p1[1] + (v2[1] / l2) * rr];
      if (i === 0) shape.moveTo(a[0], a[1]); else shape.lineTo(a[0], a[1]);
      shape.quadraticCurveTo(p1[0], p1[1], b[0], b[1]);
    }
    shape.closePath();
    return shape;
  }
  function stadium(len, wid) {
    const s = new THREE.Shape(), r = wid / 2, h = len / 2 - r;
    s.absarc(0, h, r, 0, Math.PI, false);
    s.absarc(0, -h, r, Math.PI, Math.PI * 2, false);
    s.closePath();
    return s;
  }

  // flat swatches of the internals atlas (see makeAtlas); the light bars use one too, so they share that shader
  const SW = { chip: 0, silver: 1, graphite: 2, label: 3, steel: 4, edge: 5 };
  const swUV = (k) => [0.875, 1 - (16 + 32 * k) / 256];
  function paint(g, k) {
    const [u, v] = swUV(k), n = g.attributes.position.count, a = new Float32Array(n * 2);
    for (let i = 0; i < n; i++) { a[i * 2] = u; a[i * 2 + 1] = v; }
    g.setAttribute('uv', new THREE.BufferAttribute(a, 2));
    return g;
  }

  /* ════════════ build the parts ════════════ */
  // geometry is merged per part (not per material) so every part can move on its own when exploded
  const P = {};
  const add = (name, mat, g) => { (P[name] || (P[name] = { mat, list: [] })).list.push(g); };
  // rigid parts: extrudes are welded for smooth normals; lathes keep their own analytic normals
  const rigid = (g, m) => place(g.attributes.normal ? g : finish(g), m);

  // core body (black) — built first because the wings are fitted against it
  const bodyPts = sampleClosed(BODY, 380);
  const core = pillow({ outline: bodyPts, rh: EDGE_R, rv: EDGE_RV, top: TOP, bot: BOT, seg: 9, grid: 5.2, offset: -0.7 });
  deformGeometry(core.geometry);
  core.geometry.computeVertexNormals();

  // white wings (right built, left mirrored)
  const wingSamples = sampleClosed(WING_R.map(([p]) => GRIP(p)), 300);
  const wingRadii = tagRadii(wingSamples, WING_R, (t) => (t === 'o' ? EDGE_R : SEAM_R), 5);
  const wingTop = (x, z) => TOP(x, z) + WING_LIFT;
  const wingBot = (x, z) => BOT(x, z) - 0.5;
  const wingR = pillow({ outline: wingSamples, rh: wingRadii, rv: EDGE_RV, top: wingTop, bot: wingBot, seg: 9, grid: 4.6 });
  const wingL = pillow({
    outline: wingSamples.map(([x, z]) => [-x, z]), rh: wingRadii, rv: EDGE_RV, top: wingTop, bot: wingBot, seg: 9, grid: 4.6,
  });
  for (const w of [wingR, wingL]) {
    clampToEnvelope(w.geometry, core, 0.7, WING_LIFT, 0.5, -30, 30);
    deformGeometry(w.geometry); w.geometry.computeVertexNormals(); add('shellTop', 'white', w.geometry);
  }
  const wingSurf = (x, z) => (x >= 0 ? wingR.topAt(x, z) : wingL.topAt(x, z));

  add('shellBack', 'black', core.geometry);

  // touchpad (white)
  const tpPts = sampleClosed(TOUCHPAD, 220);
  const tp = pillow({ outline: tpPts, rh: 1.7, rv: 1.4, top: TP_TOP, bot: (x, z) => TP_TOP(x, z) - 4.4, seg: 7, grid: 4 });
  deformGeometry(tp.geometry); tp.geometry.computeVertexNormals(); add('touchpad', 'white', tp.geometry);

  // light bars (emissive) — thin capsules in the gap between touchpad and wings
  const barTop = (x, z) => TP_TOP(x, z) - 0.42;
  const barDefs = [
    { a: BAR_A, b: BAR_B },
    { a: [-BAR_A[0], BAR_A[1]], b: [-BAR_B[0], BAR_B[1]] },
  ];
  for (const { a, b } of barDefs) {
    const bp = pillow({ outline: capsule(a, b, BAR_HALF_W, 12), rh: 0.95, rv: 0.9, top: barTop, bot: (x, z) => barTop(x, z) - 3.2, seg: 6, grid: 3 });
    deformGeometry(bp.geometry); bp.geometry.computeVertexNormals(); add('lightBars', 'lightBar', paint(bp.geometry, SW.chip));
  }

  // bumpers L1 / R1
  const bumperPts = sampleClosed(BUMPER_R, 110);
  for (const sx of [1, -1]) {
    const bp = pillow({
      outline: bumperPts.map(([x, z]) => [x * sx, z]), rh: 2.0, rv: 2.3,
      top: (x, z) => TOP(x, z) - 3.4, bot: (x, z) => TOP(x, z) - 10.6, seg: 6, grid: 3,
    });
    deformGeometry(bp.geometry); bp.geometry.computeVertexNormals(); add(sx > 0 ? 'R1' : 'L1', 'stick', bp.geometry);
  }

  // L2 / R2 triggers — side profile extruded across x
  {
    const s = new THREE.Shape();
    s.moveTo(45.5, -1.6);
    s.bezierCurveTo(52.4, -1.0, 57.0, -3.4, 58.6, -8.4);
    s.bezierCurveTo(60.0, -13.2, 59.4, -20.4, 56.8, -25.2);
    s.quadraticCurveTo(55.2, -28.2, 52.6, -26.9);
    s.bezierCurveTo(51.3, -26.0, 52.1, -21.6, 52.0, -17.6);
    s.bezierCurveTo(51.9, -13.2, 50.4, -10.6, 47.4, -9.4);
    s.lineTo(45.0, -8.9);
    s.closePath();
    for (const sx of [1, -1]) {
      const g = new THREE.ExtrudeGeometry(s, { depth: 17, bevelEnabled: true, bevelThickness: 1.6, bevelSize: 1.3, bevelSegments: 6, curveSegments: 24 });
      g.deleteAttribute('uv'); g.deleteAttribute('normal'); g.clearGroups();
      const p = g.attributes.position;
      for (let i = 0; i < p.count; i++) {
        const u = p.getX(i), v = p.getY(i), w = p.getZ(i);
        // (u, v, w) → x = 51.5 + w, y = v, z = -u  (proper rotation, winding preserved)
        p.setXYZ(i, sx * (50 + w), v, -u);
      }
      if (sx < 0) g.index ? g.index.array.reverse() : flipWinding(g);
      const w2 = weld(g); g.dispose(); deformGeometry(w2); w2.computeVertexNormals(); add(sx > 0 ? 'R2' : 'L2', 'stick', w2);
    }
  }

  // stick bosses (raised rings in the black face)
  const STICKS = [[-30.6, 1.6], [30.6, 1.6]];
  for (const [x, z] of STICKS) {
    const g = lathe([[22.5, -1.8], [20.5, -0.3], [18, 0.85], [15.4, 1.8], [13.5, 2.3], [12.3, 2.25], [11.4, 1.7], [10.85, 0.5], [10.7, -2.2]], 64);
    g.translate(x, TOP(x, z), z);
    const w = weld(g); g.dispose(); deformGeometry(w); w.computeVertexNormals(); add('shellBack', 'black', w);
  }

  // analog sticks (concave caps)
  const stickProfile = [
    [3.0, -1.2], [4.5, -0.6], [4.7, 0.6], [4.55, 4.3], [5.3, 5.0], [7.4, 5.3], [8.9, 5.7], [9.6, 6.35],
    [9.9, 7.3], [9.9, 8.55], [9.65, 9.35], [9.1, 9.85], [8.3, 10.05], [7.4, 9.95], [6.2, 9.62], [4.4, 9.32],
    [2.2, 9.2], [0.0, 9.17],
  ];
  for (const [x, z] of STICKS) add(x < 0 ? 'stickL' : 'stickR', 'stick', rigid(lathe(stickProfile, 64), frameAt(x, z, TOP)));

  // D-pad: four separate pointed keys on the left wing
  {
    const s = new THREE.Shape();
    // local: +x = outward, tip points toward the d-pad centre (−x). Shape space y = −z.
    roundedPoly(s, [[-5.0, 0], [-0.7, 4.3], [5.2, 4.3], [5.2, -4.3], [-0.7, -4.3]], [1.1, 1.0, 1.7, 1.7, 1.0]);
    const C = [-56.4, -24.6], D = 8.3;
    for (let k = 0; k < 4; k++) {
      const ang = (k * Math.PI) / 2; // 0: right, 1: toward player, 2: left, 3: away
      const cx = C[0] + Math.cos(ang) * D, cz = C[1] + Math.sin(ang) * D;
      const g = extrudeXZ(s, 1.35, 0.75, 0.7);
      g.translate(0, -0.55, 0);
      add('dpad', 'gloss', rigid(g, frameAt(cx, cz, wingSurf, 0, -ang)));
    }
  }

  // face buttons: four plain glossy round caps on the right wing
  {
    const C = [56.4, -25.0], D = 12.3;
    const prof = [[5.25, -0.9], [5.3, 0.55], [5.17, 1.3], [4.8, 1.86], [4.0, 2.28], [2.7, 2.48], [0, 2.53]];
    for (let k = 0; k < 4; k++) {
      const ang = (k * Math.PI) / 2;
      add('face', 'gloss', rigid(lathe(prof, 48), frameAt(C[0] + Math.cos(ang) * D, C[1] + Math.sin(ang) * D, wingSurf)));
    }
  }

  // small pills near the touchpad corners, centre button and a slim pill below it
  {
    const pill = stadium(7.4, 3.3);
    for (const sx of [-1, 1]) {
      const g = extrudeXZ(pill, 0.6, 0.55, 0.5);
      g.translate(0, -0.35, 0);
      add('center', 'gloss', rigid(g, frameAt(sx * 44.6, -45.2, wingSurf, 0, sx * 0.2)));
    }
    add('center', 'gloss', rigid(lathe([[4.7, -0.8], [4.75, 0.5], [4.5, 1.25], [3.6, 1.8], [2, 2.02], [0, 2.06]], 48), frameAt(0, -0.6, TOP)));
    const mute = extrudeXZ(stadium(9.4, 2.9), 0.35, 0.5, 0.45);
    mute.rotateY(Math.PI / 2);
    mute.translate(0, -0.4, 0);
    add('center', 'gloss', rigid(mute, frameAt(0, 10.4, TOP)));
  }

  /* ════════════ internals — only ever seen while the intro has the controller exploded ════════════
     All of them share one material: every vertex samples a flat swatch of a small colour / roughness /
     metalness atlas, except the mainboard's top face, which samples the printed trace pattern. */
  const INT = {};
  const addI = (name, g) => { (INT[name] || (INT[name] = [])).push(g); return g; };
  const bx = (w, h, d, x, y, z, k) => paint(new THREE.BoxGeometry(w, h, d).translate(x, y, z), k);
  const lp = (prof, k, segs = 28) => paint(lathe(prof, segs), k);
  // rounded slab, plan w × d, height h, bottom at y = 0, smooth shaded
  function slab(w, d, h, r, k) {
    const s = new THREE.Shape(), hw = w / 2 - r - 0.6, hd = d / 2 - r - 0.6;
    s.absarc(hw, hd, r, 0, Math.PI / 2); s.absarc(-hw, hd, r, Math.PI / 2, Math.PI);
    s.absarc(-hw, -hd, r, Math.PI, Math.PI * 1.5); s.absarc(hw, -hd, r, Math.PI * 1.5, Math.PI * 2);
    const g = new THREE.ExtrudeGeometry(s, { depth: h - 1.2, bevelEnabled: true, bevelThickness: 0.6, bevelSize: 0.6, bevelSegments: 2, curveSegments: 3 });
    g.deleteAttribute('uv'); g.deleteAttribute('normal'); g.clearGroups();
    g.rotateX(-Math.PI / 2); g.translate(0, 0.6, 0);
    return paint(finish(g), k);
  }

  // mainboard: shaped 1.4 mm board, printed face + a few chips, shield can and the USB-C port
  const PCB_Y = -2.6;
  {
    const outline = [[-46, -44], [46, -44], [52, -36], [52, -6], [44, 4], [24, 8], [-24, 8], [-44, 4], [-52, -6], [-52, -36]];
    const g = new THREE.ExtrudeGeometry(roundedPoly(new THREE.Shape(), outline.map(([x, z]) => [x, -z]), 3.5),
      { depth: 1, bevelEnabled: true, bevelThickness: 0.2, bevelSize: 0.2, bevelSegments: 1, curveSegments: 3 });
    g.clearGroups(); g.rotateX(-Math.PI / 2);
    const p = g.attributes.position, n = g.attributes.normal, uv = g.attributes.uv, [eu, ev] = swUV(SW.edge);
    for (let i = 0; i < p.count; i++) {
      if (n.getY(i) > 0.9) uv.setXY(i, ((p.getX(i) + 52) / 104) * 0.75, 1 - ((p.getZ(i) + 44) / 52) * 0.75);
      else uv.setXY(i, eu, ev);
    }
    addI('pcb', g.translate(0, PCB_Y, 0));
    const top = PCB_Y + 1.2;
    for (const [x, z, w, d, h, k] of [
      [-8, -26, 14, 14, 1.4, SW.chip], [14, -24, 16, 12, 2, SW.silver], [-27, -14, 7, 7, 1, SW.chip],
      [30, -8, 6, 5, 1, SW.chip], [0, -41, 10, 4, 3.2, SW.silver], [-36, -37, 9, 3, 1.6, SW.graphite],
      [36, -37, 9, 3, 1.6, SW.graphite], [-12, -6, 6, 3, 0.9, SW.chip], [6, -8, 3, 3, 1.2, SW.silver],
      [-30, -30, 3, 3, 1.2, SW.silver], [28, -28, 4, 4, 0.9, SW.chip],
    ]) addI('pcb', bx(w, h, d, x, top + h / 2, z, k));
  }
  // battery pack with a label band and its connector
  addI('battery', slab(52, 24, 8.5, 3, SW.graphite).translate(0, -14, -20));
  addI('battery', bx(32, 0.4, 20, -4, -5.4, -20, SW.label));
  addI('battery', bx(5, 3, 8, 27.6, -9.5, -20, SW.silver));
  // speaker under the centre of the board
  addI('speaker', lp([[0, 0], [9.6, 0], [10, 0.5], [10, 2.4], [9.3, 2.8], [8.2, 2.3], [6.8, 2.7], [5.4, 2.3], [4, 2.7], [2.6, 2.4], [0, 2.9]], SW.steel, 40).translate(0, -9, 4));
  addI('speaker', lp([[0, -3.4], [6, -3.4], [6, 0], [0, 0]], SW.chip, 24).translate(0, -9, 4));
  // haptic actuators: voice-coil cans lying along each grip
  for (const sx of [-1, 1]) {
    const name = sx < 0 ? 'hapticL' : 'hapticR', c = [sx * 60, -4, 32];
    const p = deform(c[0], c[1], c[2], new V3());
    const t = deform(c[0], c[1], c[2] + 1, new V3()).sub(p).normalize();
    const up = deform(c[0], c[1] + 1, c[2], new V3()).sub(p).normalize();
    const xx = new V3().crossVectors(up, t).normalize();
    up.crossVectors(t, xx);
    const m = new THREE.Matrix4().makeBasis(xx, up, t).setPosition(p);
    for (const g of [
      lp([[0, -11], [6.8, -11], [7.6, -10.2], [7.6, 9.6], [7, 10.6], [0, 10.6]], SW.steel),
      lp([[7.7, -4], [8.1, -3.4], [8.1, 3.4], [7.7, 4]], SW.silver),
      lp([[0, 10.5], [5.5, 10.5], [5.5, 11.6], [4.8, 12.2], [0, 12.2]], SW.chip),
      lp([[0, -12.6], [3, -12.6], [3, -11], [0, -11]], SW.silver, 16),
    ]) addI(name, place(g.rotateX(Math.PI / 2), m));
  }
  // trigger motor units: housing, motor can and drive gear behind each upper trigger
  for (const sx of [-1, 1]) {
    const name = sx < 0 ? 'motorL' : 'motorR', x = sx * 46, y = -2, z = -38;
    addI(name, slab(15, 16, 10, 2.5, SW.graphite).translate(x, y - 5, z));
    addI(name, lp([[0, -7], [4.3, -7], [4.6, -6.4], [4.6, 6.4], [4.3, 7], [0, 7]], SW.silver, 24).rotateZ(Math.PI / 2).translate(x - sx * 1.5, y - 1, z + 11.5));
    addI(name, lp([[0, -1], [6.4, -1], [6.8, -0.5], [6.8, 0.5], [6.4, 1], [0, 1]], SW.steel, 32).rotateZ(Math.PI / 2).translate(x + sx * 8.4, y, z));
  }

  /* ════════════ merge per part, centre, scale ════════════ */
  const geos = {};
  for (const [name, { list }] of Object.entries(P)) geos[name] = merge(list);
  for (const [name, list] of Object.entries(INT)) geos[name] = merge(list);
  const box = new THREE.Box3();
  for (const name of Object.keys(P)) { geos[name].computeBoundingBox(); box.union(geos[name].boundingBox); }
  const center = box.getCenter(new V3());
  for (const g of Object.values(geos)) { g.translate(-center.x, -center.y, -center.z); g.scale(MM, MM, MM); }

  /* ---------- materials (one clone per part, so each part can pulse on its own) ---------- */
  const atlas = typeof document !== 'undefined' ? makeAtlas(THREE) : null;
  const base = {
    white: new THREE.MeshPhysicalMaterial({ color: 0xe9ecef, roughness: 0.5, metalness: 0, clearcoat: 0.22, clearcoatRoughness: 0.45 }),
    black: new THREE.MeshPhysicalMaterial({ color: 0x0d0d0e, roughness: 0.36, metalness: 0, clearcoat: 0.08, clearcoatRoughness: 0.5, specularIntensity: 0.65, specularColor: 0xf2ebe4 }),
    gloss: new THREE.MeshPhysicalMaterial({ color: 0x07080a, roughness: 0.2, metalness: 0, clearcoat: 1, clearcoatRoughness: 0.06 }),
    stick: new THREE.MeshPhysicalMaterial({ color: 0x0c0c0d, roughness: 0.3, metalness: 0, clearcoat: 0.6, clearcoatRoughness: 0.22, specularColor: 0xf2ebe4 }),
    internal: new THREE.MeshStandardMaterial(atlas
      ? { map: atlas.albedo, roughnessMap: atlas.orm, metalnessMap: atlas.orm, roughness: 1, metalness: 1 }
      : { color: 0x2a2e32, roughness: 0.5, metalness: 0.3 }),
  };
  // light bars: same shader as the internals (dark swatch), lit by their emissive
  base.lightBar = base.internal.clone();
  base.lightBar.emissive = accent;
  base.lightBar.emissiveIntensity = 0;
  const materials = Object.values(base);
  const group = new THREE.Group();
  group.name = 'controller';
  const parts = {}, meshes = {}, exploded = new THREE.Box3(), pb = new THREE.Box3();
  for (const [name, g] of Object.entries(geos)) {
    g.computeBoundingBox();
    const rest = g.boundingBox.getCenter(new V3());
    g.translate(-rest.x, -rest.y, -rest.z);
    g.computeBoundingBox();
    g.computeBoundingSphere();
    const kind = P[name] ? P[name].mat : 'internal';
    const material = kind === 'lightBar' ? base.lightBar : base[kind].clone();
    if (material !== base.lightBar) materials.push(material);
    const mesh = new THREE.Mesh(g, material);
    mesh.name = name;
    const pg = new THREE.Group();
    pg.name = name;
    pg.position.copy(rest);
    pg.add(mesh);
    group.add(pg);
    const e = EXPLODE[name];
    const offset = new V3(e[0], e[1], e[2]);
    parts[name] = { name, group: pg, mesh, material, rest, offset, out: e[3], snap: e[4], tilt: e[5] || 0, internal: !P[name] };
    meshes[name] = mesh;
    exploded.union(pb.copy(g.boundingBox).translate(rest).translate(offset));
  }

  /* ---------- anchors (group-local units unless noted) ---------- */
  const toLocal = (v) => v.sub(center).multiplyScalar(MM);
  const barRest = parts.lightBars.rest;
  // light-bar centre lines, local to the lightBars part
  const lightBars = barDefs.map(({ a, b }) => {
    const pa = toLocal(deform(a[0], barTop(a[0], a[1]), a[1], new V3())).sub(barRest);
    const pb2 = toLocal(deform(b[0], barTop(b[0], b[1]), b[1], new V3())).sub(barRest);
    const m = frameAt((a[0] + b[0]) / 2, (a[1] + b[1]) / 2, barTop);
    const normal = new V3().setFromMatrixColumn(m, 1).normalize();
    const mid = toLocal(new V3().setFromMatrixPosition(m)).sub(barRest);
    return { a: pa, b: pb2, mid, normal };
  });
  const tpM = frameAt(0, -36, TP_TOP);
  const touchpad = {
    center: toLocal(new V3().setFromMatrixPosition(tpM)),
    normal: new V3().setFromMatrixColumn(tpM, 1).normalize(),
  };
  // callout points, local to their part
  const labels = {
    triggers: { part: 'R2', p: new V3(0.02, -0.02, -0.02) },
    haptics: { part: 'hapticL', p: new V3() },
    touchpad: { part: 'touchpad', p: new V3(-0.06, 0.02, 0.04) },
    lightBar: { part: 'lightBars', p: lightBars[1].mid.clone() },
    battery: { part: 'battery', p: new V3(0.1, 0.04, 0) },
  };
  const size = box.getSize(new V3()).multiplyScalar(MM);
  const localBox = new THREE.Box3().setFromCenterAndSize(new V3(), size);

  let tris = 0;
  for (const g of Object.values(geos)) tris += g.index.count / 3;

  return {
    group,
    parts,
    meshes,
    materials,
    lightBarMaterial: base.lightBar,
    anchors: { lightBars, touchpad, radius: size.length() / 2, box: localBox, exploded, labels },
    stats: { triangles: tris, parts: Object.keys(parts).length, buildMs: Math.round(performance.now() - t0), sizeMM: box.getSize(new V3()).toArray().map((v) => Math.round(v)) },
    dispose() {
      for (const g of Object.values(geos)) g.dispose();
      for (const m of materials) m.dispose();
      if (atlas) { atlas.albedo.dispose(); atlas.orm.dispose(); }
    },
  };

  function flipWinding(g) {
    const p = g.attributes.position;
    for (let i = 0; i < p.count; i += 3) {
      const x = p.getX(i + 1), y = p.getY(i + 1), z = p.getZ(i + 1);
      p.setXYZ(i + 1, p.getX(i + 2), p.getY(i + 2), p.getZ(i + 2));
      p.setXYZ(i + 2, x, y, z);
    }
  }
}

/* ── internals atlas: 512 × 256, printed mainboard pattern (left 384 × 192) + flat swatches (right column).
   Drawn twice from the same seed: once as colour, once as roughness (G) / metalness (B). ── */
const SWATCH = [['#0b0c0d', 0.4, 0], ['#c9ced3', 0.26, 0.95], ['#2a2e32', 0.55, 0.12], ['#d6dade', 0.62, 0], ['#5a6066', 0.3, 0.85], ['#101415', 0.6, 0]];
function makeAtlas(THREE) {
  const mk = (orm) => {
    const c = document.createElement('canvas');
    c.width = 512; c.height = 256;
    const g = c.getContext('2d');
    const col = (hex, r, m) => (orm ? `rgb(255,${Math.round(r * 255)},${Math.round(m * 255)})` : hex);
    g.fillStyle = col('#121819', 0.62, 0); g.fillRect(0, 0, 384, 192);
    let s = 9;
    const rnd = () => ((s = (s * 16807) % 2147483647) / 2147483647);
    g.lineCap = 'round'; g.lineJoin = 'round';
    for (let i = 0; i < 90; i++) {
      let x = 8 + rnd() * 368, y = 8 + rnd() * 176;
      g.strokeStyle = col('#3a4447', 0.42, 0.4);
      g.lineWidth = rnd() < 0.2 ? 2.6 : 1.2;
      g.beginPath(); g.moveTo(x, y);
      for (let k = 0; k < 3; k++) {
        const L = 8 + rnd() * 46, d = Math.floor(rnd() * 6);
        if (d < 2) x += d ? L : -L; else if (d < 4) y += d === 2 ? L * 0.6 : -L * 0.6; else { x += L * 0.5; y += (d === 4 ? 1 : -1) * L * 0.5; }
        x = Math.min(380, Math.max(4, x)); y = Math.min(188, Math.max(4, y));
        g.lineTo(x, y);
      }
      g.stroke();
      g.fillStyle = col('#8e969b', 0.3, 0.9);
      g.fillRect(x - 2, y - 2, 4, 4);
    }
    g.strokeStyle = col('#4b5558', 0.6, 0); g.lineWidth = 1;
    for (const [x, y, w, h] of [[150, 62, 66, 66], [250, 56, 82, 62], [52, 104, 40, 40], [306, 134, 34, 28]]) g.strokeRect(x, y, w, h);
    g.fillStyle = col('#8e969b', 0.3, 0.9);
    for (const [x, y] of [[20, 20], [364, 20], [40, 150], [344, 150]]) { g.beginPath(); g.arc(x, y, 6, 0, 7); g.fill(); }
    SWATCH.forEach(([hex, r, m], k) => { g.fillStyle = col(hex, r, m); g.fillRect(384, k * 32, 128, 32); });
    const t = new THREE.CanvasTexture(c);
    t.anisotropy = 4;
    return t;
  };
  const albedo = mk(false), orm = mk(true);
  albedo.colorSpace = THREE.SRGBColorSpace;
  return { albedo, orm };
}

/* ── 2D helpers ─────────────────────────────────────────────── */
/* constrained Lawson flips on a half-edge structure (rim edges have no twin, so they never flip) */
function delaunayFlip(P, T) {
  const n = T.length, tri = new Int32Array(n * 3), opp = new Int32Array(n * 3).fill(-1);
  const map = new Map();
  for (let t = 0; t < n; t++) {
    for (let e = 0; e < 3; e++) {
      const a = T[t][e], b = T[t][(e + 1) % 3], h = t * 3 + e;
      tri[h] = a;
      const twin = map.get(b * 1048576 + a);
      if (twin !== undefined) { opp[h] = twin; opp[twin] = h; map.delete(b * 1048576 + a); } else map.set(a * 1048576 + b, h);
    }
  }
  const stack = [];
  for (let h = 0; h < n * 3; h++) if (opp[h] >= 0) stack.push(h);
  const link = (h, o) => { opp[h] = o; if (o >= 0) opp[o] = h; };
  let guard = n * 60;
  while (stack.length && guard-- > 0) {
    const h = stack.pop(), g = opp[h];
    if (g < 0) continue;
    const t = (h / 3) | 0, e = h % 3, t2 = (g / 3) | 0, e2 = g % 3;
    const a = tri[h], b = tri[t * 3 + (e + 1) % 3], c = tri[t * 3 + (e + 2) % 3];
    const d = tri[t2 * 3 + (e2 + 2) % 3];
    if (inCircle(P[a], P[b], P[c], P[d]) <= 1e-7) continue;
    if (area2(P[a], P[d], P[c]) <= 1e-10 || area2(P[d], P[b], P[c]) <= 1e-10) continue;
    const N1 = opp[t * 3 + (e + 1) % 3], N2 = opp[t * 3 + (e + 2) % 3];
    const N3 = opp[t2 * 3 + (e2 + 1) % 3], N4 = opp[t2 * 3 + (e2 + 2) % 3];
    tri[t * 3] = a; tri[t * 3 + 1] = d; tri[t * 3 + 2] = c;
    tri[t2 * 3] = d; tri[t2 * 3 + 1] = b; tri[t2 * 3 + 2] = c;
    link(t * 3, N3); link(t * 3 + 1, t2 * 3 + 2); link(t * 3 + 2, N2);
    link(t2 * 3, N4); link(t2 * 3 + 1, N1);
    stack.push(t * 3, t * 3 + 2, t2 * 3, t2 * 3 + 1);
  }
  for (let t = 0; t < n; t++) T[t] = [tri[t * 3], tri[t * 3 + 1], tri[t * 3 + 2]];
  return T;
}
function area2(a, b, c) { return (b[0] - a[0]) * (c[1] - a[1]) - (b[1] - a[1]) * (c[0] - a[0]); }
function inCircle(a, b, c, d) {
  const adx = a[0] - d[0], ady = a[1] - d[1], bdx = b[0] - d[0], bdy = b[1] - d[1], cdx = c[0] - d[0], cdy = c[1] - d[1];
  return (adx * adx + ady * ady) * (bdx * cdy - bdy * cdx) - (bdx * bdx + bdy * bdy) * (adx * cdy - ady * cdx) + (cdx * cdx + cdy * cdy) * (adx * bdy - ady * bdx);
}
function inPoly(x, z, poly) {
  let inside = false;
  for (let i = 0, j = poly.length - 1; i < poly.length; j = i++) {
    const [xi, zi] = poly[i], [xj, zj] = poly[j];
    if ((zi > z) !== (zj > z) && x < ((xj - xi) * (z - zi)) / (zj - zi) + xi) inside = !inside;
  }
  return inside;
}
function segDist(x, z, a, b) {
  const dx = b[0] - a[0], dz = b[1] - a[1];
  const l2 = dx * dx + dz * dz || 1;
  let t = ((x - a[0]) * dx + (z - a[1]) * dz) / l2;
  t = t < 0 ? 0 : t > 1 ? 1 : t;
  return Math.hypot(x - (a[0] + dx * t), z - (a[1] + dz * t));
}
/* exact point-in-polygon and "closer than r" tests with edges bucketed by z (same answers as
   inPoly / distPoly, without scanning every edge for every Steiner candidate) */
function polyIndex(poly, r) {
  let z0 = Infinity, z1 = -Infinity;
  for (const p of poly) { z0 = Math.min(z0, p[1]); z1 = Math.max(z1, p[1]); }
  const B = 2, nb = Math.ceil((z1 - z0) / B) + 1, cross = [], near = [];
  for (let k = 0; k < nb; k++) { cross.push([]); near.push([]); }
  for (let i = 0, j = poly.length - 1; i < poly.length; j = i++) {
    const za = Math.min(poly[i][1], poly[j][1]), zb = Math.max(poly[i][1], poly[j][1]);
    for (let k = Math.max(0, Math.floor((za - z0) / B)); k <= Math.min(nb - 1, Math.floor((zb - z0) / B)); k++) cross[k].push(j);
    for (let k = Math.max(0, Math.floor((za - r - z0) / B)); k <= Math.min(nb - 1, Math.floor((zb + r - z0) / B)); k++) near[k].push(j);
  }
  const n = poly.length;
  const bucket = (z) => Math.min(nb - 1, Math.max(0, Math.floor((z - z0) / B)));
  return {
    inside(x, z) {
      let inside = false;
      for (const j of cross[bucket(z)]) {
        const [xi, zi] = poly[(j + 1) % n], [xj, zj] = poly[j];
        if ((zi > z) !== (zj > z) && x < ((xj - xi) * (z - zi)) / (zj - zi) + xi) inside = !inside;
      }
      return inside;
    },
    near(x, z, rr) {
      for (const j of near[bucket(z)]) if (segDist(x, z, poly[j], poly[(j + 1) % n]) < rr) return true;
      return false;
    },
  };
}
function rayHit(ox, oz, dx, dz, a, b) {
  const ex = b[0] - a[0], ez = b[1] - a[1];
  const den = dx * ez - dz * ex;
  if (Math.abs(den) < 1e-12) return -1;
  const wx = a[0] - ox, wz = a[1] - oz;
  const t = (wx * ez - wz * ex) / den;
  const u = (wx * dz - wz * dx) / den;
  return u >= 0 && u <= 1 ? t : -1;
}
function distPoly(x, z, poly) {
  let best = Infinity;
  for (let i = 0; i < poly.length; i++) best = Math.min(best, segDist(x, z, poly[i], poly[(i + 1) % poly.length]));
  return best;
}

/* V4 alias: the WebGL stage loads every model as create<Name>(THREE, opts) */
export { createDualSense as createController };
