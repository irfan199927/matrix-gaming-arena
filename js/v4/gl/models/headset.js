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
   Procedural sleek VR headset (original design, no logos or brand marks).
   1 unit = 100 mm, centred, up +y, glossy visor faces +z; the wearer looks toward -z.
   Matte white shell, glossy dark front visor with four tracking cameras and a slim light strip,
   recessed lens assembly + plush face gasket, halo head strap with rear fit dial and a short cable.

   createHeadset(THREE, { accent }) → { group, parts, meshes, materials, lightBarMaterial, accentMaterials,
     anchors:{ radius, box, exploded, visor:{center,normal}, labels{id:{part,p,text}} }, stats, dispose }
   ═══════════════════════════════════════════════════════════════ */
export function createHeadset(THREE, opts = {}) {
  const t0 = performance.now();
  const K = makeKit(THREE), { V3, sm } = K;
  const accent = new THREE.Color(opts.accent ?? 0x38f24a);
  const defs = [];
  const add = (name, geo, mat, o = {}) => defs.push({ name, geo, mat, ...o });
  const f = (x) => -0.12 * (x / 0.95) * (x / 0.95), df = (x) => -0.24 * x / 0.9025;
  const bend = (g) => K.bendZ(g, f, df);

  const noise = K.canvasTex(128, 128, (c, w, h) => {
    const d = c.createImageData(w, h); let s = 7;
    for (let i = 0; i < w * h; i++) { s = (s * 16807) % 2147483647; const v = 150 + (s % 105); d.data.set([v, v, v, 255], i * 4); }
    c.putImageData(d, 0, 0);
  }, false);

  const M = {
    white: new THREE.MeshPhysicalMaterial({ color: 0xe9ecef, roughness: 0.5, clearcoat: 0.22, clearcoatRoughness: 0.45 }),
    visor: new THREE.MeshPhysicalMaterial({ color: 0x040507, roughness: 0.1, metalness: 0, clearcoat: 1, clearcoatRoughness: 0.035, specularIntensity: 1 }),
    cam: new THREE.MeshPhysicalMaterial({ color: 0x1b2a4a, roughness: 0.06, metalness: 0.35, clearcoat: 1, clearcoatRoughness: 0.03, iridescence: 1, iridescenceIOR: 1.6, iridescenceThicknessRange: [200, 500] }),
    strip: new THREE.MeshStandardMaterial({ color: 0x0c110d, roughness: 0.3, emissive: accent.clone(), emissiveIntensity: 0 }),
    dark: new THREE.MeshPhysicalMaterial({ color: 0x15171a, roughness: 0.55, clearcoat: 0.1, clearcoatRoughness: 0.5 }),
    glass: new THREE.MeshPhysicalMaterial({ color: 0x07090c, roughness: 0.04, metalness: 0.25, clearcoat: 1, clearcoatRoughness: 0.02, iridescence: 0.8, iridescenceIOR: 1.5, iridescenceThicknessRange: [150, 420] }),
    gasket: new THREE.MeshPhysicalMaterial({ color: 0x23262a, roughness: 0.92, sheen: 1, sheenColor: new THREE.Color(0x9aa6b6), sheenRoughness: 0.42, bumpMap: noise, bumpScale: 0.6 }),
    pad: new THREE.MeshPhysicalMaterial({ color: 0x2c3035, roughness: 0.92, sheen: 1, sheenColor: new THREE.Color(0x8e99a8), sheenRoughness: 0.5, bumpMap: noise, bumpScale: 0.5 }),
    dial: new THREE.MeshStandardMaterial({ color: 0x3b4046, metalness: 0.9, roughness: 0.34 }),
    rubber: new THREE.MeshStandardMaterial({ color: 0x0e0f11, roughness: 0.62 }),
  };

  /* outline of the face: superellipse with a soft nose notch at the bottom */
  const outline = (w, h, notch, n = 150) => {
    const pts = [];
    for (let i = 0; i < 260; i++) {
      const a = (i / 260) * Math.PI * 2, c = Math.cos(a), s = Math.sin(a);
      const x = (w / 2) * Math.sign(c) * Math.pow(Math.abs(c), 2 / 3.2);
      let y = (h / 2) * Math.sign(s) * Math.pow(Math.abs(s), 2 / 3.2);
      if (y < 0) y += notch * Math.exp(-Math.pow(x / 0.3, 2)) * Math.pow(-y / (h / 2), 1.5);
      pts.push([x, y]);
    }
    return K.resample(pts, n);
  };
  const VZ = 0.4;                    // visor front (at x = 0)
  const vz = (x) => VZ + f(x);

  /* shell + visor */
  add('shell', bend(K.slab(outline(1.9, 0.98, 0.14), { depth: 0.53, bf: 0.1, bb: 0.1, steps: 6 }).translate(0, 0, 0.015)), M.white, { off: [0, 0, 0], out: 0.05, snap: 0.3 });
  const camPos = [[0.66, 0.2], [-0.66, 0.2], [0.5, -0.2], [-0.5, -0.2]];
  const rings = camPos.map(([x, y]) => K.lathe([[0, -0.012], [0.083, -0.012], [0.083, 0.01, 0.01], [0, 0.01]], 28).rotateY(Math.atan2(-df(x), 1)).translate(x, y, vz(x)));
  add('visor', K.merge([bend(K.slab(outline(1.876, 0.956, 0.14), { depth: 0.2, bf: 0.08, bb: 0, steps: 6 }).translate(0, 0, 0.3)), ...rings]), M.visor, { off: [0, 0.04, 0.85], out: 0.03, snap: 0.28 });
  const domes = camPos.map(([x, y]) => K.lathe([[0, 0.0], [0.052, 0.0], [0.052, 0.008, 0.004], [0.032, 0.022, 0.01], [0, 0.026]], 24).rotateY(Math.atan2(-df(x), 1)).translate(x, y, vz(x) + 0.004));
  add('cameras', K.merge(domes), M.cam, { off: [0, 0.12, 1.55], out: 0.01, snap: 0.32 });
  add('lightStrip', bend(new THREE.CapsuleGeometry(0.016, 0.58, 5, 14).rotateZ(Math.PI / 2).translate(0, 0.28, VZ + 0.002)), M.strip, { off: [0, 0.3, 2.0], out: 0.0, snap: 0.34 });

  /* lens assembly + gasket */
  add('lensPlate', bend(K.slab(outline(1.4, 0.74, 0.12, 100), { depth: 0.02, bf: 0.006, bb: 0.006, steps: 3 }).translate(0, 0, -0.255)), M.dark, { off: [0, 0, -0.35], out: 0.08, snap: 0.22, internal: true });
  const hous = [-1, 1].map((sd) => K.lathe([[0.2, -0.28], [0.31, -0.28], [0.31, -0.37, 0.025], [0.27, -0.415, 0.03], [0.205, -0.405], [0.2, -0.28]], 48).translate(sd * 0.34, 0, f(0.34)));
  add('lensHousings', K.merge(hous), M.dark, { off: [0, 0, -0.7], out: 0.1, snap: 0.2, internal: true });
  const lenses = [-1, 1].map((sd) => K.lathe([[0, -0.4], [0.1, -0.393, 0.01], [0.19, -0.376, 0.02], [0.21, -0.36, 0.01], [0.21, -0.3], [0, -0.3]], 48).translate(sd * 0.34, 0, f(0.34)));
  add('lenses', K.merge(lenses), M.glass, { off: [0, 0, -1.1], out: 0.12, snap: 0.18, internal: true });
  const gpts = outline(1.46, 0.8, 0.14, 130).map(([x, y]) => new V3(x, y, -0.325 + f(x)));
  add('gasket', K.sweep(gpts, { closed: true, na: 28, uRep: 14, vRep: 3, sec: K.sec(0.078, 0.1, 2.6) }), M.gasket, { off: [0, 0, -1.55], out: 0.14, snap: 0.14 });

  /* halo strap: straight arms along the head, elliptical rear, arms hinge at the shell sides */
  const yAt = (z) => 0.04 - 0.1 * sm(-0.2, -2.05, z);
  const hp = [];
  for (let i = 0; i <= 14; i++) { const z = -0.02 - (0.83 * i) / 14; hp.push(new V3(0.95, yAt(z), z)); }
  for (let i = 1; i < 70; i++) { const p = (i / 70) * Math.PI, z = -0.85 - 1.2 * Math.sin(p); hp.push(new V3(0.95 * Math.cos(p), yAt(z), z)); }
  for (let i = 14; i >= 0; i--) { const z = -0.02 - (0.83 * i) / 14; hp.push(new V3(-0.95, yAt(z), z)); }
  const bandSec = K.sec(0.05, 0.13, 4);
  add('halo', K.sweep(hp, { na: 24, B: new V3(0, 1, 0), sec: (a) => bandSec(a) }), M.white, { off: [0, 0.25, -0.45], out: 0.06, snap: 0.24 });
  const pp = hp.filter((p) => p.z < -0.95);
  const padSec = K.sec(0.036, 0.1, 3);
  add('haloPad', K.sweep(pp, { na: 18, B: new V3(0, 1, 0), sec: (a, s) => { const c = padSec(a); const t = 0.55 + 0.45 * sm(0, 0.12, s) * sm(0, 0.12, 1 - s); return [c[0] - 0.071, c[1] * t]; } }), M.pad, { off: [0, -0.4, -0.55], out: 0.1, snap: 0.2 });
  add('hinges', K.merge([-1, 1].map((sd) => new THREE.CylinderGeometry(0.15, 0.15, 0.3, 28).translate(sd * 0.95, 0.03, -0.1))), M.white, { off: [0, 0, -0.1], out: 0.04, snap: 0.3 });

  /* fit dial + cable */
  const ry = yAt(-2.05);
  add('dialHousing', K.rbox(0.64, 0.42, 0.28, 0.12, 0.07).translate(0, ry, -2.19), M.white, { off: [0, 0.1, -0.85], out: 0.1, snap: 0.2 });
  add('fitDial', K.lathe([[0, -2.5], [0.2, -2.5, 0.03], [0.2, -2.37, 0.02], [0.17, -2.33], [0, -2.33]], 56, [28, 0.03, -2.48, -2.36, 0.1]).translate(0, ry, 0), M.dial, { off: [0, 0.15, -1.45], out: 0.12, snap: 0.17 });
  const cur = new THREE.CatmullRomCurve3([new V3(-0.62, -0.44, 0.0), new V3(-0.62, -0.62, -0.08), new V3(-0.56, -0.86, -0.38), new V3(-0.42, -1.02, -0.74), new V3(-0.34, -1.06, -0.92)]);
  const plug = K.rbox(0.1, 0.17, 0.07, 0.03, 0.015).rotateX(Math.PI / 2).rotateZ(0.5).translate(-0.31, -1.075, -0.99);
  add('cable', K.merge([new THREE.TubeGeometry(cur, 56, 0.04, 10, false), plug]), M.rubber, { off: [-0.6, -0.5, -0.2], out: 0.07, snap: 0.26 });

  /* assemble */
  const group = new THREE.Group(); group.name = 'headset';
  const inner = new THREE.Group(); group.add(inner);
  const A = K.assemble(defs, { root: inner }, inner);
  const V = (x, y, z) => new V3(x, y, z);
  const L = (part, p, text) => ({ part, p: p.clone().sub(A.parts[part].rest), text });
  const labels = {
    cameras: L('cameras', V(0.66, 0.2, vz(0.66) + 0.02), 'Tracking cameras'),
    lenses: L('lenses', V(-0.34, 0, -0.4), 'Lenses'),
    lightStrip: L('lightStrip', V(0.2, 0.28, VZ + 0.015), 'Light strip'),
    halo: L('halo', V(0.95, yAt(-0.5), -0.5), 'Halo strap'),
    fitDial: L('fitDial', V(0, ry, -2.5), 'Fit dial'),
  };
  const size = A.box.getSize(new V3());
  const visor = { center: V(0, 0, VZ).add(inner.position), normal: V(0, 0, 1) };
  const materials = Object.values(M), textures = [noise];
  return {
    group, parts: A.parts, meshes: A.meshes, materials,
    lightBarMaterial: M.strip, accentMaterials: [M.strip],
    anchors: { radius: size.length() / 2, box: A.box, exploded: A.exploded, visor, labels },
    stats: { triangles: A.tris, parts: defs.length, meshes: defs.length, buildMs: Math.round(performance.now() - t0), sizeMM: size.multiplyScalar(100).toArray().map(Math.round) },
    dispose() { Object.values(A.meshes).forEach((m) => m.geometry.dispose()); materials.forEach((m) => m.dispose()); textures.forEach((t) => t.dispose()); },
  };
}
