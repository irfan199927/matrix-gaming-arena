/*KIT-BEGIN (shared geometry kit, identical in wheel.js and headset.js)*/
function makeKit(THREE) {
  const { Vector2: V2, Vector3: V3 } = THREE;
  const clamp = (x, a, b) => Math.min(b, Math.max(a, x));
  const sm = (a, b, x) => { const t = clamp((x - a) / (b - a), 0, 1); return t * t * (3 - 2 * t); };

  /* 2D outlines */
  const area = (p) => { let a = 0; for (let i = 0; i < p.length; i++) { const q = p[(i + 1) % p.length]; a += p[i][0] * q[1] - q[0] * p[i][1]; } return a / 2; };
  const ccw = (p) => (area(p) > 0 ? p : p.slice().reverse());
  function rrectPts(w, h, r, n = 6) {
    const out = [], cx = w / 2 - r, cy = h / 2 - r;
    [[cx, cy, 0], [-cx, cy, 90], [-cx, -cy, 180], [cx, -cy, 270]].forEach(([x, y, a0]) => {
      for (let i = 0; i <= n; i++) { const a = (a0 + (90 * i) / n) * Math.PI / 180; out.push([x + r * Math.cos(a), y + r * Math.sin(a)]); }
    });
    return out;
  }
  function resample(p, n) {
    const L = [0]; for (let i = 0; i < p.length; i++) { const q = p[(i + 1) % p.length]; L.push(L[i] + Math.hypot(q[0] - p[i][0], q[1] - p[i][1])); }
    const tot = L[p.length], out = []; let k = 0;
    for (let i = 0; i < n; i++) {
      const d = (tot * i) / n; while (L[k + 1] < d) k++;
      const t = (d - L[k]) / (L[k + 1] - L[k] || 1), a = p[k], b = p[(k + 1) % p.length];
      out.push([a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t]);
    }
    return out;
  }

  /* geometry plumbing */
  function fixWinding(g) {
    const P = g.attributes.position.array, Nn = g.attributes.normal.array, I = g.index.array;
    for (let t = 0; t < I.length; t += 3) {
      const a = I[t] * 3, b = I[t + 1] * 3, c = I[t + 2] * 3;
      const ux = P[b] - P[a], uy = P[b + 1] - P[a + 1], uz = P[b + 2] - P[a + 2], vx = P[c] - P[a], vy = P[c + 1] - P[a + 1], vz = P[c + 2] - P[a + 2];
      const nx = uy * vz - uz * vy, ny = uz * vx - ux * vz, nz = ux * vy - uy * vx;
      const d = nx * (Nn[a] + Nn[b] + Nn[c]) + ny * (Nn[a + 1] + Nn[b + 1] + Nn[c + 1]) + nz * (Nn[a + 2] + Nn[b + 2] + Nn[c + 2]);
      if (d < 0) { const s = I[t + 1]; I[t + 1] = I[t + 2]; I[t + 2] = s; }
    }
    return g;
  }
  function merge(list) {
    let vc = 0, ic = 0;
    for (const g of list) { vc += g.attributes.position.count; ic += g.index.count; }
    const pos = new Float32Array(vc * 3), nor = new Float32Array(vc * 3), uv = new Float32Array(vc * 2), col = list.some((g) => g.attributes.color) ? new Float32Array(vc * 3).fill(1) : null;
    const idx = new Uint32Array(ic); let vo = 0, io = 0;
    for (const g of list) {
      const n = g.attributes.position.count;
      pos.set(g.attributes.position.array, vo * 3); nor.set(g.attributes.normal.array, vo * 3);
      if (g.attributes.uv) uv.set(g.attributes.uv.array, vo * 2);
      if (col && g.attributes.color) col.set(g.attributes.color.array, vo * 3);
      for (let i = 0; i < g.index.count; i++) idx[io + i] = g.index.array[i] + vo;
      vo += n; io += g.index.count;
    }
    const m = new THREE.BufferGeometry();
    m.setAttribute('position', new THREE.BufferAttribute(pos, 3)); m.setAttribute('normal', new THREE.BufferAttribute(nor, 3)); m.setAttribute('uv', new THREE.BufferAttribute(uv, 2));
    if (col) m.setAttribute('color', new THREE.BufferAttribute(col, 3));
    m.setIndex(new THREE.BufferAttribute(idx, 1));
    list.forEach((g) => g.dispose());
    return m;
  }
  function paint(g, c) { const n = g.attributes.position.count, a = new Float32Array(n * 3); for (let i = 0; i < n; i++) { a[i * 3] = c.r; a[i * 3 + 1] = c.g; a[i * 3 + 2] = c.b; } g.setAttribute('color', new THREE.BufferAttribute(a, 3)); return g; }

  /* bend z by f(x); normals follow (n' = J^-T n) */
  function bendZ(geo, f, df) {
    const p = geo.attributes.position, n = geo.attributes.normal;
    for (let i = 0; i < p.count; i++) {
      const x = p.getX(i); p.setZ(i, p.getZ(i) + f(x));
      const nz = n.getZ(i), nx = n.getX(i) - df(x) * nz, ny = n.getY(i), l = Math.hypot(nx, ny, nz) || 1;
      n.setXYZ(i, nx / l, ny / l, nz / l);
    }
    p.needsUpdate = true; n.needsUpdate = true; return geo;
  }

  /* slab: extruded outline with analytically smooth rounded edges, z centred */
  function slab(outline, o) {
    const pts = ccw(outline), n = pts.length, depth = o.depth, bf = o.bf ?? 0, bb = o.bb ?? bf, steps = o.steps ?? 5;
    const uvf = o.uv || ((x, y) => [x, y]);
    const nrm = pts.map((p, i) => { const a = pts[(i - 1 + n) % n], b = pts[(i + 1) % n]; const tx = b[0] - a[0], ty = b[1] - a[1], l = Math.hypot(tx, ty) || 1; return [ty / l, -tx / l]; });
    const zf = depth / 2, zb = -depth / 2, specs = [];
    if (bf > 0) for (let j = 0; j <= steps; j++) { const ph = (j / steps) * Math.PI / 2; specs.push([bf * (1 - Math.sin(ph)), zf - bf * (1 - Math.cos(ph)), Math.sin(ph), Math.cos(ph)]); }
    else specs.push([0, zf, 0, 1], [0, zf, 1, 0]);
    if (bb > 0) for (let j = steps; j >= 0; j--) { const ph = (j / steps) * Math.PI / 2; specs.push([bb * (1 - Math.sin(ph)), zb + bb * (1 - Math.cos(ph)), Math.sin(ph), -Math.cos(ph)]); }
    else specs.push([0, zb, 1, 0], [0, zb, 0, -1]);
    const pos = [], nor = [], uv = [], idx = [];
    specs.forEach(([ins, z, nk, nzv]) => {
      for (let i = 0; i < n; i++) {
        const x = pts[i][0] - nrm[i][0] * ins, y = pts[i][1] - nrm[i][1] * ins;
        pos.push(x, y, z); nor.push(nrm[i][0] * nk, nrm[i][1] * nk, nzv); uv.push(...uvf(x, y));
      }
    });
    for (let k = 0; k < specs.length - 1; k++) for (let i = 0; i < n; i++) {
      const a = k * n + i, b = k * n + (i + 1) % n, c = (k + 1) * n + i, d = (k + 1) * n + (i + 1) % n; idx.push(a, c, b, b, c, d);
    }
    const cap = (ring) => {
      const c2 = []; for (let i = 0; i < n; i++) c2.push(new V2(pos[(ring * n + i) * 3], pos[(ring * n + i) * 3 + 1]));
      THREE.ShapeUtils.triangulateShape(c2, []).forEach((f) => idx.push(ring * n + f[0], ring * n + f[1], ring * n + f[2]));
    };
    cap(0); cap(specs.length - 1);
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3)); g.setAttribute('normal', new THREE.Float32BufferAttribute(nor, 3)); g.setAttribute('uv', new THREE.Float32BufferAttribute(uv, 2));
    g.setIndex(idx); return g;
  }
  const rbox = (w, h, d, r, b, steps = 4) => slab(rrectPts(w, h, r, 6), { depth: d, bf: b, bb: b, steps, uv: (x, y) => [x * 0.5, y * 0.5] });

  /* sweep a cross-section along a path */
  const sec = (rn, rb, e = 2) => (a) => { const c = Math.cos(a), s = Math.sin(a); return [rn * Math.sign(c) * Math.pow(Math.abs(c), 2 / e), rb * Math.sign(s) * Math.pow(Math.abs(s), 2 / e)]; };
  function sweep(pts, o) {
    const n = pts.length, closed = !!o.closed, na = o.na || 20, Bv = o.B || new V3(0, 0, 1);
    const cen = new V3(); pts.forEach((p) => cen.add(p)); cen.divideScalar(n);
    const Ts = [], Ns = [], Bs = []; let sg = 0;
    for (let i = 0; i < n; i++) {
      const a = pts[closed ? (i - 1 + n) % n : Math.max(i - 1, 0)], b = pts[closed ? (i + 1) % n : Math.min(i + 1, n - 1)];
      const t = b.clone().sub(a).normalize(), bb = Bv.clone().addScaledVector(t, -t.dot(Bv)).normalize(), nn = new V3().crossVectors(bb, t).normalize();
      sg += nn.dot(pts[i].clone().sub(cen)); Ts.push(t); Bs.push(bb); Ns.push(nn);
    }
    sg = sg >= 0 ? 1 : -1; Ns.forEach((v) => v.multiplyScalar(sg));
    const pos = [], nor = [], uv = [], idx = [], dl = 1e-3; let len = 0;
    for (let i = 0; i < n; i++) {
      if (i) len += pts[i].distanceTo(pts[i - 1]);
      const s = closed ? i / n : i / (n - 1);
      for (let j = 0; j < na; j++) {
        const a = (j / na) * Math.PI * 2, c = o.sec(a, s, i), c1 = o.sec(a + dl, s, i), c0 = o.sec(a - dl, s, i);
        const tn = c1[0] - c0[0], tb = c1[1] - c0[1], l = Math.hypot(tn, tb) || 1, nn = tb / l, nb = -tn / l;
        const P = pts[i];
        pos.push(P.x + Ns[i].x * c[0] + Bs[i].x * c[1], P.y + Ns[i].y * c[0] + Bs[i].y * c[1], P.z + Ns[i].z * c[0] + Bs[i].z * c[1]);
        nor.push(Ns[i].x * nn + Bs[i].x * nb, Ns[i].y * nn + Bs[i].y * nb, Ns[i].z * nn + Bs[i].z * nb);
        uv.push(len * (o.uRep || 1), (j / na) * (o.vRep || 1));
      }
    }
    const rings = closed ? n : n - 1;
    for (let i = 0; i < rings; i++) for (let j = 0; j < na; j++) {
      const i2 = (i + 1) % n, a = i * na + j, b = i * na + (j + 1) % na, c = i2 * na + j, d = i2 * na + (j + 1) % na; idx.push(a, c, b, b, c, d);
    }
    if (!closed) [[0, -1], [n - 1, 1]].forEach(([i, sgn]) => {
      const ci = pos.length / 3; pos.push(pts[i].x, pts[i].y, pts[i].z); nor.push(Ts[i].x * sgn, Ts[i].y * sgn, Ts[i].z * sgn); uv.push(0, 0);
      const rb = pos.length / 3;
      for (let j = 0; j < na; j++) { const k = (i * na + j) * 3; pos.push(pos[k], pos[k + 1], pos[k + 2]); nor.push(Ts[i].x * sgn, Ts[i].y * sgn, Ts[i].z * sgn); uv.push(0, 0); }
      for (let j = 0; j < na; j++) idx.push(ci, rb + j, rb + (j + 1) % na);
    });
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3)); g.setAttribute('normal', new THREE.Float32BufferAttribute(nor, 3)); g.setAttribute('uv', new THREE.Float32BufferAttribute(uv, 2));
    g.setIndex(idx); return g;
  }

  /* lathe about +z. profile [[r, z, cornerRadius?]...] ascending z, starts/ends on the axis */
  function roundPoly(p, seg = 5) {
    const out = [new V2(p[0][0], p[0][1])];
    for (let i = 1; i < p.length - 1; i++) {
      const r = p[i][2] || 0;
      if (!r) { out.push(new V2(p[i][0], p[i][1])); continue; }
      const a = new V2(p[i - 1][0], p[i - 1][1]), c = new V2(p[i][0], p[i][1]), b = new V2(p[i + 1][0], p[i + 1][1]);
      const d1 = a.clone().sub(c), d2 = b.clone().sub(c), rr = Math.min(r, d1.length() * 0.49, d2.length() * 0.49);
      const s = c.clone().addScaledVector(d1.normalize(), rr), e = c.clone().addScaledVector(d2.normalize(), rr);
      for (let k = 0; k <= seg; k++) { const t = k / seg, u = 1 - t; out.push(new V2(u * u * s.x + 2 * u * t * c.x + t * t * e.x, u * u * s.y + 2 * u * t * c.y + t * t * e.y)); }
    }
    out.push(new V2(p[p.length - 1][0], p[p.length - 1][1])); return out;
  }
  function lathe(profile, seg = 40, ripple) {
    const g = new THREE.LatheGeometry(roundPoly(profile), seg); g.rotateX(Math.PI / 2);
    if (ripple) { // [count, depth, zMin, zMax, rMin]
      const p = g.attributes.position;
      for (let i = 0; i < p.count; i++) {
        const x = p.getX(i), y = p.getY(i), z = p.getZ(i), r = Math.hypot(x, y);
        if (z > ripple[2] && z < ripple[3] && r > ripple[4]) { const k = 1 + ripple[1] * Math.cos(Math.atan2(y, x) * ripple[0]); p.setXY(i, x * k, y * k); }
      }
      g.computeVertexNormals();
    }
    return g;
  }

  function canvasTex(w, h, draw, srgb = true) {
    const c = document.createElement('canvas'); c.width = w; c.height = h; draw(c.getContext('2d'), w, h);
    const t = new THREE.CanvasTexture(c); t.wrapS = t.wrapT = THREE.RepeatWrapping; t.anisotropy = 8; if (srgb) t.colorSpace = THREE.SRGBColorSpace; return t;
  }

  /* assemble parts: defs [{name, geo, mat, off:[x,y,z], out, snap, tilt, pivot, parent, internal}] */
  function assemble(defs, containers, inner) {
    const parts = {}, meshes = {}, ub = new THREE.Box3(), eb = new THREE.Box3(), tmp = new THREE.Box3(); let tris = 0;
    for (const d of defs) {
      const g = fixWinding(d.geo); g.computeBoundingBox(); tmp.copy(g.boundingBox);
      const rest = d.pivot ? d.pivot.clone() : tmp.getCenter(new V3()), offset = new V3(...(d.off || [0, 0, 0]));
      ub.union(tmp); eb.union(tmp.clone().translate(offset)).union(tmp);
      g.translate(-rest.x, -rest.y, -rest.z); g.computeBoundingSphere();
      const mesh = new THREE.Mesh(g, d.mat); mesh.name = d.name;
      const pg = new THREE.Group(); pg.name = d.name; pg.position.copy(rest); pg.add(mesh);
      (containers[d.parent || 'root']).add(pg);
      parts[d.name] = { name: d.name, group: pg, mesh, material: d.mat, rest, offset, out: d.out ?? 0.05, snap: d.snap ?? 0.25, tilt: d.tilt || 0, internal: !!d.internal };
      meshes[d.name] = mesh; tris += g.index.count / 3;
    }
    const center = ub.getCenter(new V3()); inner.position.copy(center).negate();
    return { parts, meshes, tris, box: ub.clone().translate(center.clone().negate()), exploded: eb.clone().translate(center.clone().negate()) };
  }
  return { V2, V3, clamp, sm, rrectPts, resample, ccw, slab, rbox, sweep, sec, merge, paint, lathe, bendZ, canvasTex, assemble };
}
/*KIT-END*/

/* ═══════════════════════════════════════════════════════════════
   Procedural GT/formula hybrid sim-racing wheel + quick release + direct-drive base.
   Original design, no logos or brand marks. 1 unit = 100 mm, centred, up +y, face toward +z.
   Rim ≈ 300 mm wide D-shape with a flat bottom; carbon plate; telemetry screen; shift LEDs;
   buttons + encoders; two magnetic paddles hinged behind; QR hub; motor + clamp.

   createWheel(THREE, { accent }) → { group, parts, meshes, materials, lightBarMaterial, accentMaterials,
     anchors:{ radius, box, exploded, labels{id:{part,p,text}} }, stats, dispose }
   parts.steer.group  = everything that steers (rotate about local z, through the wheel axis);
   parts.paddleL/R    = origins at the hinge (rotate about x: tilt);
   every other part   = { group (at .rest), mesh, offset, out, snap, tilt, internal }.
   ═══════════════════════════════════════════════════════════════ */
export function createWheel(THREE, opts = {}) {
  const t0 = performance.now();
  const K = makeKit(THREE), { V3, sm } = K;
  const accent = new THREE.Color(opts.accent ?? 0x38f24a);
  const defs = [];
  const add = (name, geo, mat, o = {}) => defs.push({ name, geo, mat, ...o });

  /* ── textures ── */
  const carbonTex = K.canvasTex(256, 256, (c, w, h) => {
    c.fillStyle = '#17191c'; c.fillRect(0, 0, w, h);
    const s = 8;
    for (let i = 0; i < w / s; i++) for (let j = 0; j < h / s; j++) {
      const horiz = ((i + j) % 4) < 2, x = i * s, y = j * s;
      const g = horiz ? c.createLinearGradient(x, y, x, y + s) : c.createLinearGradient(x, y, x + s, y);
      g.addColorStop(0, horiz ? '#3b4046' : '#101214'); g.addColorStop(0.5, horiz ? '#16181b' : '#2d3237'); g.addColorStop(1, horiz ? '#0f1113' : '#3a3f45');
      c.fillStyle = g; c.fillRect(x, y, s, s);
    }
  });
  carbonTex.repeat.set(1, 1);
  const gripDots = (bump) => K.canvasTex(64, 64, (c, w, h) => {
    c.fillStyle = bump ? '#fff' : '#e9ecef'; c.fillRect(0, 0, w, h);
    for (const [x, y] of [[16, 16], [48, 48], [16, 48], [48, 16]]) {
      const g = c.createRadialGradient(x, y, 0, x, y, 9); g.addColorStop(0, bump ? '#000' : '#8c949b'); g.addColorStop(0.7, bump ? '#333' : '#c3c9ce'); g.addColorStop(1, bump ? '#fff' : '#e9ecef');
      c.fillStyle = g; c.beginPath(); c.arc(x, y, 9, 0, 7); c.fill();
    }
  }, !bump);
  const gripMap = gripDots(false), gripBump = gripDots(true);
  const screenTex = K.canvasTex(512, 192, (c, w, h) => {
    c.fillStyle = '#000'; c.fillRect(0, 0, w, h); c.fillStyle = '#fff'; c.textBaseline = 'alphabetic';
    c.font = '700 150px "Arial Narrow", Arial, sans-serif'; c.textAlign = 'left'; c.fillText('4', 26, 150);
    c.font = '700 92px Arial, sans-serif'; c.textAlign = 'center'; c.fillText('218', 270, 118);
    c.font = '700 22px Arial, sans-serif'; c.fillText('KM/H', 270, 150);
    c.textAlign = 'right'; c.font = '700 34px Arial, sans-serif'; c.fillText('1:42.381', 492, 60); c.font = '700 20px Arial, sans-serif'; c.fillText('LAP 07', 492, 90); c.fillText('P3', 492, 120);
    for (let i = 0; i < 24; i++) { c.globalAlpha = i < 17 ? 1 : 0.25; c.fillRect(26 + i * 20, 168, 14, 12); }
    c.globalAlpha = 1;
  }, true);
  screenTex.wrapS = screenTex.wrapT = THREE.ClampToEdgeWrapping;
  gripMap.repeat.set(1, 1); gripBump.repeat.set(1, 1);

  /* ── materials ── */
  const M = {
    carbon: new THREE.MeshPhysicalMaterial({ color: 0xffffff, map: carbonTex, roughness: 0.42, metalness: 0.15, clearcoat: 1, clearcoatRoughness: 0.07 }),
    rim: new THREE.MeshPhysicalMaterial({ color: 0x15171a, roughness: 0.66, sheen: 1, sheenColor: new THREE.Color(0x626a72), sheenRoughness: 0.5 }),
    grip: new THREE.MeshPhysicalMaterial({ color: 0xffffff, map: gripMap, bumpMap: gripBump, bumpScale: 2.2, roughness: 0.74, sheen: 0.6, sheenColor: new THREE.Color(0xffffff), sheenRoughness: 0.6 }),
    gloss: new THREE.MeshPhysicalMaterial({ color: 0x07080a, roughness: 0.2, clearcoat: 1, clearcoatRoughness: 0.06 }),
    screen: new THREE.MeshStandardMaterial({ color: 0x020403, roughness: 0.25, metalness: 0, emissive: accent.clone(), emissiveMap: screenTex, emissiveIntensity: 0 }),
    led: new THREE.MeshStandardMaterial({ color: 0x0c110d, roughness: 0.3, emissive: accent.clone(), emissiveIntensity: 0 }),
    mark: new THREE.MeshStandardMaterial({ color: 0x0c110d, roughness: 0.4, emissive: accent.clone(), emissiveIntensity: 0 }),
    cap: new THREE.MeshPhysicalMaterial({ color: 0x17191c, roughness: 0.46, clearcoat: 0.25, clearcoatRoughness: 0.4 }),
    ring: new THREE.MeshStandardMaterial({ color: 0xffffff, vertexColors: true, roughness: 0.42 }),
    alloy: new THREE.MeshStandardMaterial({ color: 0xaeb4ba, metalness: 1, roughness: 0.3 }),
    darkAlloy: new THREE.MeshPhysicalMaterial({ color: 0x2b2f34, metalness: 0.95, roughness: 0.34, clearcoat: 0.3, clearcoatRoughness: 0.3 }),
    base: new THREE.MeshPhysicalMaterial({ color: 0xe9ecef, roughness: 0.5, clearcoat: 0.22, clearcoatRoughness: 0.45 }),
    clamp: new THREE.MeshStandardMaterial({ color: 0x303439, metalness: 0.85, roughness: 0.42 }),
  };

  /* ── rim: D shape, flat bottom ── */
  const R = 1.5, YB = -1.16, KS = 0.34, RZ = 0.05;
  const smax = (a, b, k) => 0.5 * (a + b + Math.sqrt((a - b) * (a - b) + k * k));
  const raw = []; for (let i = 0; i < 400; i++) { const th = -Math.PI / 2 + (i / 400) * Math.PI * 2; raw.push([R * Math.cos(th), smax(R * Math.sin(th), YB, KS)]); }
  const rimPts2 = K.resample(raw, 240), rimPts = rimPts2.map(([x, y]) => new V3(x, y, RZ));
  add('rimCore', K.sweep(rimPts, { closed: true, na: 24, sec: K.sec(0.145, 0.168, 2), uRep: 2, vRep: 1 }), M.rim, { off: [0, 0, 0.08], out: 0.06, snap: 0.26 });
  for (const sd of [1, -1]) {
    const sel = rimPts.filter((p) => p.x * sd > 0.3 && p.y > -0.86 && p.y < 0.98);
    const n = sel.length;
    add(sd > 0 ? 'gripR' : 'gripL', K.sweep(sel, { na: 28, uRep: 25, vRep: 24, sec: (a, s) => { const t = sm(0, 0.13, s) * sm(0, 0.13, 1 - s); return K.sec(0.145 + 0.034 * t + 0.003, 0.168 + 0.034 * t + 0.003, 2)(a); } }), M.grip, { off: [sd * 0.75, 0.05, 0.2], out: 0.07, snap: 0.25 });
  }
  const topPts = rimPts.filter((p) => Math.abs(p.x) < 0.075 && p.y > 1.2);
  add('topMark', K.sweep(topPts, { na: 16, sec: (a, s) => K.sec(0.145 + 0.014, 0.168 + 0.014, 2)(a) }), M.mark, { off: [0, 0.3, 0.2], out: 0.08, snap: 0.24 });

  /* ── carbon plate ── */
  const pc = [[0.55, 0.80], [0, 0.84], [-0.55, 0.80], [-1.0, 0.72], [-1.44, 0.5], [-1.46, 0.1], [-1.4, -0.25], [-1.0, -0.42], [-0.55, -0.6], [0, -0.68], [0.55, -0.6], [1.0, -0.42], [1.4, -0.25], [1.46, 0.1], [1.44, 0.5], [1.0, 0.72]];
  const plateCurve = new THREE.CatmullRomCurve3(pc.map(([x, y]) => new V3(x, y, 0)), true, 'catmullrom', 0.5).getPoints(220).map((p) => [p.x, p.y]);
  add('plate', K.slab(plateCurve, { depth: 0.12, bf: 0.04, bb: 0.03, steps: 5, uv: (x, y) => [x, y] }).translate(0, 0, 0.04), M.carbon, { off: [0, 0, -0.18], out: 0.1, snap: 0.2 });

  /* ── telemetry display + shift lights ── */
  add('bezel', K.slab(K.rrectPts(1.08, 0.44, 0.09, 6), { depth: 0.06, bf: 0.02, bb: 0, steps: 4 }).translate(0, 0.42, 0.12), M.gloss, { off: [0, 0.15, 0.5], out: 0.03, snap: 0.3 });
  add('screen', K.slab(K.rrectPts(0.96, 0.32, 0.05, 6), { depth: 0.014, bf: 0.004, bb: 0, steps: 3, uv: (x, y) => [x / 0.96 + 0.5, y / 0.32 + 0.5] }).translate(0, 0.42, 0.157), M.screen, { off: [0, 0.3, 0.95], out: 0.02, snap: 0.31 });
  const archY = (x) => 0.7 + 0.05 * (1 - (x / 0.8) * (x / 0.8));
  const archPts = []; for (let i = 0; i <= 40; i++) { const x = -0.78 + (1.56 * i) / 40; archPts.push(new V3(x, archY(x), 0.115)); }
  add('shiftBar', K.sweep(archPts, { na: 14, sec: K.sec(0.052, 0.032, 3) }), M.gloss, { off: [0, 0.45, 0.55], out: 0.05, snap: 0.28 });
  const leds = [];
  for (let i = 0; i < 13; i++) { const x = -0.72 + i * 0.12, g = new THREE.SphereGeometry(0.036, 14, 10); g.scale(1, 1, 0.55); g.translate(x, archY(x), 0.143); leds.push(g); }
  add('shiftLights', K.merge(leds), M.led, { off: [0, 0.6, 0.9], out: 0.06, snap: 0.3 });

  /* ── buttons + encoders ── */
  const rings = [], caps = [], knobs = [];
  const ringCols = [new THREE.Color(0xeef2f4), new THREE.Color(0x3b8bff), new THREE.Color(0xffb02e), new THREE.Color(0xff4a4a)];
  const bpos = [[0.95, 0.34], [1.15, 0.14], [0.95, -0.08], [1.12, -0.28]];
  bpos.forEach(([x, y], i) => [1, -1].forEach((sd) => {
    const c = ringCols[sd > 0 ? i : (i + 2) % 4];
    rings.push(K.paint(K.lathe([[0, 0.098], [0.08, 0.098, 0.005], [0.08, 0.114, 0.006], [0, 0.114]], 24).translate(sd * x, y, 0), c));
    caps.push(K.lathe([[0, 0.104], [0.062, 0.104], [0.062, 0.122, 0.012], [0.05, 0.136, 0.02], [0, 0.138]], 24).translate(sd * x, y, 0));
  }));
  add('buttonRings', K.merge(rings), M.ring, { off: [0, 0, 0.45], out: 0.07, snap: 0.27 });
  add('buttons', K.merge(caps), M.cap, { off: [0, 0, 0.8], out: 0.09, snap: 0.28 });
  [-1, 1].forEach((sd) => knobs.push(K.lathe([[0, 0.1], [0.12, 0.1], [0.12, 0.17, 0.018], [0.1, 0.215, 0.025], [0, 0.215]], 40, [24, 0.035, 0.115, 0.2, 0.05]).translate(sd * 0.5, -0.22, 0)));
  add('encoders', K.merge(knobs), M.alloy, { off: [0, -0.35, 0.95], out: 0.11, snap: 0.29 });

  /* ── paddle shifters (origin at the hinge) ── */
  const xc = (y) => Math.sqrt(1.28 * 1.28 - y * y) - 0.1, wd = (y) => 0.2 + 0.07 * sm(0.4, -0.1, y) - 0.06 * sm(-0.3, -0.75, y);
  const Y0 = 0.46, Y1 = -0.78, PZ = -0.27;
  for (const sd of [1, -1]) {
    const o = [], N = 28;
    for (let i = 0; i <= N; i++) { const y = Y0 + ((Y1 - Y0) * i) / N; o.push([xc(y) + wd(y) / 2, y]); }
    for (let i = 1; i < 10; i++) { const a = (i / 10) * Math.PI, r = wd(Y1) / 2; o.push([xc(Y1) + r * Math.cos(a), Y1 - r * Math.sin(a)]); }
    for (let i = N; i >= 0; i--) { const y = Y0 + ((Y1 - Y0) * i) / N; o.push([xc(y) - wd(y) / 2, y]); }
    for (let i = 1; i < 10; i++) { const a = Math.PI + (i / 10) * Math.PI, r = wd(Y0) / 2; o.push([xc(Y0) + r * Math.cos(a), Y0 - r * Math.sin(a)]); }
    const blade = K.slab(o.map(([x, y]) => [sd * x, y]), { depth: 0.05, bf: 0.016, bb: 0.016, steps: 3, uv: (x, y) => [x, y] }).translate(0, 0, PZ);
    const post = K.lathe([[0, PZ - 0.01], [0.05, PZ - 0.01], [0.05, 0.0], [0, 0.0]], 16).translate(sd * xc(Y0), Y0, 0);
    const pivot = new V3(sd * xc(Y0), Y0, PZ);
    const g = K.merge([blade, post]); g.translate(-pivot.x, -pivot.y, -pivot.z).translate(pivot.x, pivot.y, pivot.z);
    add(sd > 0 ? 'paddleR' : 'paddleL', g, M.darkAlloy, { pivot, parent: 'steer', off: [sd * 0.55, 0, -0.75], tilt: -0.32 * 1, out: 0.12, snap: 0.2 });
  }

  /* ── quick release hub + direct-drive base ── */
  add('quickRelease', K.merge([
    K.lathe([[0, -0.36], [0.3, -0.36, 0.02], [0.3, -0.16], [0.36, -0.15, 0.02], [0.52, -0.1, 0.02], [0.52, -0.02, 0.02], [0.42, -0.02], [0, -0.02]], 48),
    K.lathe([[0, -0.29], [0.4, -0.29, 0.015], [0.4, -0.2, 0.015], [0, -0.2]], 48, [30, 0.03, -0.29, -0.2, 0.2]),
    ...[0, 1, 2, 3, 4, 5].map((i) => K.lathe([[0, -0.115], [0.04, -0.115], [0.04, -0.09, 0.01], [0, -0.08]], 12).translate(0.45 * Math.cos(i * Math.PI / 3), 0.45 * Math.sin(i * Math.PI / 3), 0)),
  ]), M.alloy, { parent: 'steer', off: [0, 0, -1.15], out: 0.13, snap: 0.17 });
  add('base', K.lathe([[0, -1.62], [0.46, -1.62, 0.03], [0.46, -1.54, 0.03], [0.7, -1.54, 0.05], [0.78, -1.44, 0.06], [0.78, -0.52, 0.06], [0.72, -0.42, 0.05], [0.4, -0.42, 0.03], [0.4, -0.3, 0.03], [0, -0.3]], 72), M.base, { off: [0, 0, -2.3], out: 0.14, snap: 0.14 });
  const plate = K.rbox(1.3, 1.3, 0.2, 0.12, 0.05).rotateX(Math.PI / 2).translate(0, -0.8, -0.98);
  const screw = new THREE.CylinderGeometry(0.09, 0.09, 0.55, 20, 1).translate(0, -1.1, -0.98);
  const tbar = new THREE.CapsuleGeometry(0.05, 0.5, 6, 14).rotateZ(Math.PI / 2).translate(0, -1.4, -0.98);
  const padc = new THREE.CylinderGeometry(0.2, 0.2, 0.04, 28).translate(0, -0.9, -0.98);
  add('clamp', K.merge([plate, screw, tbar, padc]), M.clamp, { off: [0, -0.5, -2.1], out: 0.15, snap: 0.13 });

  /* ── assemble ── */
  const group = new THREE.Group(); group.name = 'wheel';
  const inner = new THREE.Group(), steer = new THREE.Group(); steer.name = 'steer';
  inner.add(steer); group.add(inner);
  const A = K.assemble(defs, { root: inner, steer }, inner);
  A.parts.steer = { name: 'steer', group: steer, internal: false };
  const V = (x, y, z) => new V3(x, y, z);
  const L = (part, p, text) => ({ part, p: p.clone().sub(A.parts[part].rest), text });
  const labels = {
    paddles: L('paddleR', V(1.1, -0.2, PZ), 'Paddle shifters'),
    shiftLights: L('shiftLights', V(0, 0.75, 0.143), 'Shift lights'),
    display: L('screen', V(0, 0.42, 0.164), 'Telemetry display'),
    quickRelease: L('quickRelease', V(0, 0, -0.3), 'Quick release'),
    base: L('base', V(0, -0.1, -1.3), 'Direct-drive base'),
  };
  const size = A.box.getSize(new V3());
  const materials = [...new Set([...Object.values(M)])];
  const accentMaterials = [M.led, M.screen, M.mark];
  const textures = [carbonTex, gripMap, gripBump, screenTex];
  return {
    group, parts: A.parts, meshes: A.meshes, materials,
    lightBarMaterial: M.led, accentMaterials,
    anchors: { radius: size.length() / 2, box: A.box, exploded: A.exploded, labels, steerAxis: V(0, 0, 1).clone() },
    stats: { triangles: A.tris, parts: defs.length, meshes: defs.length, buildMs: Math.round(performance.now() - t0), sizeMM: size.multiplyScalar(100).toArray().map(Math.round) },
    dispose() { Object.values(A.meshes).forEach((m) => m.geometry.dispose()); materials.forEach((m) => m.dispose()); textures.forEach((t) => t.dispose()); },
  };
}
