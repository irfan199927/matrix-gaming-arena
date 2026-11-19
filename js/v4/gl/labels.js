/* ═══════════════════════════════════════════════════════════════
   V4 WebGL stage: DOM callouts for the hero's exploded controller.
   Part anchors are projected each frame; tags line up in columns beside the exploded model (rows above /
   below it on narrow screens) with SVG leader lines. Writes only; layout is read once per resize.
   ═══════════════════════════════════════════════════════════════ */
const NS = 'http://www.w3.org/2000/svg';
const LABELS = [
  { id: 'lightBar', text: 'Light bar', side: -1 },
  { id: 'touchpad', text: 'Touchpad', side: 1, few: 1 },
  { id: 'haptics', text: 'Haptic actuators', side: -1, few: 1 },
  { id: 'triggers', text: 'Adaptive triggers', side: 1, few: 1 },
  { id: 'battery', text: 'Battery', side: 1 },
];
const clamp = (v, a, b) => (v < a ? a : v > b ? b : v);
const clamp01 = (v) => clamp(v, 0, 1);
const seg = (t, a, b) => clamp01((t - a) / (b - a));
const outCubic = (t) => 1 - (1 - t) ** 3;
const inOutCubic = (t) => (t < 0.5 ? 4 * t * t * t : 1 - (-2 * t + 2) ** 3 / 2);

export function createLabels(THREE, host) {
  const box = document.createElement('div');
  box.className = 'gl-labels';
  box.setAttribute('aria-hidden', 'true');
  const svg = document.createElementNS(NS, 'svg');
  svg.setAttribute('class', 'gl-leaders');
  box.appendChild(svg);
  host.appendChild(box);
  let LAB = [], LSIDE = [[], []], narrow = null, measured = false, on = false;
  const v = new THREE.Vector3(), s = { x: 0, y: 0 };

  function build(isNarrow) {
    narrow = isNarrow;
    svg.replaceChildren();
    for (const l of LAB) l.tag.remove();
    LAB = LABELS.filter((l) => !narrow || l.few).map((l, i) => {
      const el = (tag, cls) => { const e = document.createElementNS(NS, tag); e.setAttribute('class', cls); svg.appendChild(e); return e; };
      const line = el('polyline', 'gl-lead');
      line.setAttribute('pathLength', '1');
      const ring = el('circle', 'gl-ring');
      const dot = el('circle', 'gl-dot');
      dot.setAttribute('r', '2.5');
      const tag = document.createElement('span');
      tag.className = `gl-tag ${l.side < 0 ? 'is-l' : 'is-r'}`;
      tag.innerHTML = `<b>${String(i + 1).padStart(2, '0')}</b>${l.text}`;
      box.appendChild(tag);
      return { ...l, i, line, ring, dot, tag, w: 0, x: 0, y: 0, ly: 0 };
    });
    LSIDE = [LAB.filter((l) => l.side < 0), LAB.filter((l) => l.side > 0)];
    measured = false;
  }

  function hide() { if (on) { box.style.visibility = 'hidden'; on = false; } }

  /* a: 0..1 entrance per label (staggered by the caller's progress), o: 0..1 exit */
  function update(model, camera, W, H, inP, outP) {
    if (narrow === null || narrow !== W < 640) build(W < 640);
    if (inP <= 0 || outP >= 1) { hide(); return; }
    if (!on) { box.style.visibility = 'visible'; on = true; }
    if (!measured) { for (const l of LAB) l.w = l.tag.offsetWidth; measured = true; }
    const toScreen = (p, o) => { p.project(camera); o.x = (p.x * 0.5 + 0.5) * W; o.y = (0.5 - p.y * 0.5) * H; return o; };
    for (const l of LAB) {
      const a = model.anchors.labels[l.id], part = model.parts[a.part];
      toScreen(v.copy(a.p).applyMatrix4(part.group.matrixWorld), l);
      l.a = seg(inP, l.i * 0.12, l.i * 0.12 + 0.5);
      l.o = seg(outP, l.i * 0.05, l.i * 0.05 + 0.6);
    }
    // the exploded model's extent on screen
    let minX = Infinity, maxX = -Infinity, minY = Infinity, maxY = -Infinity;
    const focal = H / (2 * Math.tan((camera.fov * Math.PI) / 360));
    for (const q of Object.values(model.parts)) {
      if (!q.group.visible) continue;
      q.group.getWorldPosition(v);
      const sc = q.group.getWorldScale(s.ws || (s.ws = new THREE.Vector3())).x;
      const r = ((q.mesh.geometry.boundingSphere.radius * sc * focal) / v.distanceTo(camera.position)) * 0.8;
      toScreen(v, s);
      minX = Math.min(minX, s.x - r); maxX = Math.max(maxX, s.x + r);
      minY = Math.min(minY, s.y - r * 0.6); maxY = Math.max(maxY, s.y + r * 0.6);
    }
    const M = narrow ? 14 : 32, LH = 26, top = H * 0.15 + LH / 2, bot = H * 0.86 - LH / 2;
    if (narrow) { rows(minY, maxY, M, LH, top, bot, W); return; }
    let wl = 0, wr = 0;
    for (const l of LAB) { if (l.side < 0) wl = Math.max(wl, l.w); else wr = Math.max(wr, l.w); }
    const colL = Math.max(M + wl, minX - 30), colR = Math.min(W - M - wr, maxX + 30);
    for (const arr of LSIDE) {
      arr.sort((p, q) => p.y - q.y);
      let prev = -Infinity;
      for (const l of arr) { l.ly = Math.max(l.y, prev + LH + 10, top); prev = l.ly; }
      let next = Infinity;
      for (let i = arr.length - 1; i >= 0; i--) { const l = arr[i]; l.ly = Math.min(l.ly, next - LH - 10, bot); next = l.ly; }
    }
    for (const l of LAB) {
      const sd = l.side, col = sd < 0 ? colL : colR, knee = col - sd * 28, end = col - sd * 2;
      const pts = sd * (l.x - knee) > 0 ? `${l.x.toFixed(1)},${l.y.toFixed(1)} ${end},${l.ly.toFixed(1)}`
        : `${l.x.toFixed(1)},${l.y.toFixed(1)} ${knee.toFixed(1)},${l.ly.toFixed(1)} ${end.toFixed(1)},${l.ly.toFixed(1)}`;
      draw(l, pts, col - sd * (1 - outCubic(seg(l.a, 0.5, 1))) * 10, l.ly, sd < 0 ? '-100%' : '0');
    }
  }
  // narrow screens: rows above / below the model with vertical leaders
  function rows(minY, maxY, M, LH, top, bot, W) {
    const cy = (minY + maxY) / 2;
    for (let gi = 0; gi < 2; gi++) {
      const g = LAB.filter((l) => (l.y >= cy) === (gi === 1)).sort((p, q) => p.x - q.x);
      const oneRow = g.reduce((acc, l) => acc + l.w, 0) + 12 * (g.length - 1) <= W - 2 * M;
      g.forEach((l, i) => {
        const r = oneRow ? 0 : i, dir = gi ? 1 : -1;
        l.ly = clamp((gi ? maxY : minY) + dir * (22 + LH / 2 + r * (LH + 6)), top, bot);
        let lx = oneRow && g.length > 1 ? (i === 0 ? M : W - M - l.w) : l.x < W / 2 ? l.x - 16 : l.x + 16 - l.w;
        lx = clamp(lx, M, W - M - l.w);
        const ax = l.x.toFixed(1), ay = l.y.toFixed(1), ly = l.ly.toFixed(1);
        const pts = l.x >= lx + 6 && l.x <= lx + l.w - 6 ? `${ax},${ay} ${ax},${(l.ly - (dir * LH) / 2).toFixed(1)}`
          : `${ax},${ay} ${ax},${ly} ${(l.x < lx ? lx : lx + l.w).toFixed(1)},${ly}`;
        draw(l, pts, lx, l.ly + dir * (1 - outCubic(seg(l.a, 0.5, 1))) * 8, '0');
      });
    }
  }
  function draw(l, pts, x, y, shift) {
    const ko = 1 - l.o;
    l.line.setAttribute('points', pts);
    l.line.style.strokeDashoffset = (1 - inOutCubic(seg(l.a, 0.12, 0.7))).toFixed(3);
    l.line.style.opacity = ko.toFixed(3);
    l.dot.setAttribute('cx', l.x.toFixed(1)); l.dot.setAttribute('cy', l.y.toFixed(1));
    l.dot.style.opacity = (outCubic(seg(l.a, 0, 0.2)) * ko).toFixed(3);
    l.ring.setAttribute('cx', l.x.toFixed(1)); l.ring.setAttribute('cy', l.y.toFixed(1));
    l.ring.setAttribute('r', (2.5 + 6.5 * outCubic(seg(l.a, 0, 0.55))).toFixed(2));
    l.ring.style.opacity = ((0.2 + 0.6 * (1 - seg(l.a, 0.3, 0.9))) * Math.min(1, l.a * 8) * ko).toFixed(3);
    l.tag.style.opacity = (outCubic(seg(l.a, 0.5, 1)) * ko).toFixed(3);
    l.tag.style.transform = `translate3d(${x.toFixed(1)}px, ${y.toFixed(1)}px, 0) translate(${shift}, -50%)`;
  }
  return { update, hide, remeasure() { measured = false; }, dispose() { box.remove(); } };
}
