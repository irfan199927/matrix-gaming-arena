/* ═══════════════════════════════════════════════════════════════
   V4 WebGL stage: particle morphs between models.
   Each model is sampled once (area-weighted over its visible meshes, in model-root space). A pair
   (A → B) ranks A's points by their dissolve key and B's by their forming key and pairs them rank by
   rank, so points leave A exactly where its surface burns away and land on B exactly where it forms.
   The morph is a pure function of m (0..1), so scrubbing back plays it in reverse.
   ═══════════════════════════════════════════════════════════════ */
import { MeshSurfaceSampler } from 'three/addons/math/MeshSurfaceSampler.js';

export const MORPH_D = 0.42; // share of the morph spent dissolving A (and forming B)

/* mirrors DIS_HEAD in studio.js */
const disNoise = (x, y, z) => 0.5 + (Math.sin(x * 1.31 + Math.sin(y * 1.73) * 1.7) + Math.sin(y * 1.13 + Math.sin(z * 1.57) * 1.9) + Math.sin(z * 1.47 + Math.sin(x * 1.21) * 1.3)) / 6;
export function dissolveKeys(pos, axis, R) {
  const n = pos.length / 3, out = new Float32Array(n);
  for (let i = 0; i < n; i++) {
    const x = pos[i * 3], y = pos[i * 3 + 1], z = pos[i * 3 + 2];
    const sw = Math.min(1, Math.max(0, (x * axis.x + y * axis.y + z * axis.z) / (2 * R) + 0.5));
    out[i] = Math.min(1, Math.max(0, sw * 0.8 + disNoise(x * 10, y * 10, z * 10) * 0.2));
  }
  return out;
}

/* area-weighted surface samples over the model's visible meshes, in model-root (group) space */
export function sampleModel(THREE, model, n, skip = () => false) {
  const root = model.group;
  root.updateMatrixWorld(true);
  const inv = new THREE.Matrix4().copy(root.matrixWorld).invert();
  const list = [];
  root.traverse((o) => {
    if (!o.isMesh || o.isInstancedMesh || !o.geometry?.attributes?.position || skip(o)) return;
    let vis = true;
    for (let p = o; p && p !== root; p = p.parent) if (!p.visible) { vis = false; break; }
    if (!vis) return;
    const s = new MeshSurfaceSampler(o).build();
    const d = s.distribution, area = d ? d[d.length - 1] : 0;
    const m = new THREE.Matrix4().multiplyMatrices(inv, o.matrixWorld);
    const sc = Math.cbrt(Math.abs(m.determinant())) || 1;
    if (area > 0) list.push({ s, m, area: area * sc * sc });
  });
  const total = list.reduce((a, b) => a + b.area, 0) || 1;
  const pos = new Float32Array(n * 3), v = new THREE.Vector3();
  let k = 0;
  list.forEach((e, i) => {
    const cnt = i === list.length - 1 ? n - k : Math.round((n * e.area) / total);
    for (let j = 0; j < cnt && k < n; j++, k++) {
      e.s.sample(v);
      v.applyMatrix4(e.m);
      pos[k * 3] = v.x; pos[k * 3 + 1] = v.y; pos[k * 3 + 2] = v.z;
    }
  });
  return pos;
}

/* pair A → B by rank of key; aT = (departure, arrival) in m */
export function buildPair(THREE, A, keysA, B, keysB) {
  const n = Math.min(keysA.length, keysB.length);
  const ia = Array.from({ length: keysA.length }, (_, i) => i).sort((p, q) => keysA[p] - keysA[q]);
  const ib = Array.from({ length: keysB.length }, (_, i) => i).sort((p, q) => keysB[p] - keysB[q]);
  const from = new Float32Array(n * 3), to = new Float32Array(n * 3), t = new Float32Array(n * 2), r = new Float32Array(n * 4);
  let seed = 20251031;
  const rnd = () => ((seed = (seed * 16807) % 2147483647) / 2147483647);
  for (let i = 0; i < n; i++) {
    const a = ia[Math.floor((i * keysA.length) / n)], b = ib[Math.floor((i * keysB.length) / n)];
    from.set(A.subarray(a * 3, a * 3 + 3), i * 3);
    to.set(B.subarray(b * 3, b * 3 + 3), i * 3);
    t[i * 2] = MORPH_D * keysA[a];
    t[i * 2 + 1] = 1 - MORPH_D + MORPH_D * keysB[b];
    r[i * 4] = rnd(); r[i * 4 + 1] = rnd(); r[i * 4 + 2] = rnd(); r[i * 4 + 3] = rnd();
  }
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.BufferAttribute(from, 3));
  g.setAttribute('aTo', new THREE.BufferAttribute(to, 3));
  g.setAttribute('aT', new THREE.BufferAttribute(t, 2));
  g.setAttribute('aR', new THREE.BufferAttribute(r, 4));
  return g;
}

const VS = /* glsl */`
  uniform float uM, uTime, uPx, uCurl, uOpacity;
  uniform mat4 uA, uB;
  uniform vec3 uIce, uAcc;
  attribute vec3 aTo; attribute vec2 aT; attribute vec4 aR;
  varying vec3 vCol; varying float vA;
  vec3 swirl(vec3 p) {
    return vec3(sin(p.y * 1.9 + p.z * .7), sin(p.z * 1.7 + p.x * 1.3), sin(p.x * 1.5 + p.y * 1.1));
  }
  void main() {
    float t = clamp((uM - aT.x) / max(aT.y - aT.x, 1e-3), 0., 1.);
    float e = t < .5 ? 4. * t * t * t : 1. - pow(-2. * t + 2., 3.) * .5;
    vec3 a = (uA * vec4(position, 1.)).xyz;
    vec3 b = (uB * vec4(aTo, 1.)).xyz;
    vec3 p = mix(a, b, e);
    float bell = sin(3.14159265 * t);
    vec3 d = b - a; float L = length(d) + 1e-4;
    vec3 side = normalize(cross(d / L, vec3(0., 0., 1.)) + vec3(1e-4, 0., 0.));
    p += side * bell * L * (aR.x - .5) * .42;
    p += swirl(p * .9 + aR.yzw * 6.2831 + uTime * .35) * bell * (.1 + .22 * aR.y) * uCurl * min(L, 6.) * .2;
    p.z += bell * (aR.z - .5) * min(L, 6.) * .35;
    vec4 mv = viewMatrix * vec4(p, 1.);
    gl_Position = projectionMatrix * mv;
    float on = smoothstep(0., .025, t) * (1. - smoothstep(.975, 1., t));
    vA = on * uOpacity * (.45 + .55 * aR.w) * (.75 + .5 * bell);
    vCol = mix(uIce, uAcc, smoothstep(.1, .6, bell) * (.3 + .7 * aR.x));
    gl_PointSize = max(1., uPx * (.55 + .9 * aR.w) * (1. + .6 * bell) / -mv.z);
  }`;
const FS = /* glsl */`
  varying vec3 vCol; varying float vA;
  void main() {
    float d = length(gl_PointCoord - .5);
    float a = smoothstep(.5, .08, d) * vA;
    if (a < .004) discard;
    gl_FragColor = vec4(vCol * a, a);
    #include <colorspace_fragment>
  }`;

export function createParticles(THREE, { ice, accent }) {
  const material = new THREE.ShaderMaterial({
    uniforms: {
      uM: { value: 0 }, uTime: { value: 0 }, uPx: { value: 1 }, uCurl: { value: 1 }, uOpacity: { value: 1 },
      uA: { value: new THREE.Matrix4() }, uB: { value: new THREE.Matrix4() },
      uIce: { value: new THREE.Color(ice) }, uAcc: { value: new THREE.Color(accent) },
    },
    vertexShader: VS, fragmentShader: FS,
    transparent: true, depthWrite: false, premultipliedAlpha: true,
    blending: THREE.CustomBlending, blendSrc: THREE.OneFactor, blendDst: THREE.OneFactor,
    blendSrcAlpha: THREE.OneFactor, blendDstAlpha: THREE.OneMinusSrcAlphaFactor,
  });
  const points = new THREE.Points(new THREE.BufferGeometry(), material);
  points.frustumCulled = false;
  points.visible = false;
  points.renderOrder = 8;
  return { points, material, u: material.uniforms };
}
