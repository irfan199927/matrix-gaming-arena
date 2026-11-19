/* ═══════════════════════════════════════════════════════════════
   V4 WebGL stage: the studio shared by the live stage and the still renders.
   Lighting (icy key, cool rims, accent spill), accent FX (light-bar glow, halo, contact shadow),
   the particle-dissolve material patch and the pluggable model loader.
   ═══════════════════════════════════════════════════════════════ */
export const ACCENT = '#38f24a';
export const ICE = '#eef4ff';
export const COOL = '#8fb4ff';

/* model factories: G2 owns wheel.js / headset.js;  */
const MODELS = {
  controller: ['./models/controller.js', 'createController'],
  wheel: ['./models/wheel.js', 'createWheel'],
  headset: ['./models/headset.js', 'createHeadset'],
};
export async function loadModel(THREE, name, opts = {}) {
  const [path, fn] = MODELS[name];
  const create = (await import(path))[fn];
  const model = create(THREE, { accent: ACCENT, ...opts });
  model.name = name;
  if (!model.anchors) model.anchors = {};
  if (!model.anchors.radius) {
    const b = new THREE.Box3().setFromObject(model.group);
    model.anchors.box = model.anchors.box || b;
    model.anchors.radius = b.getSize(new THREE.Vector3()).length() / 2;
  }
  return model;
}

/* materials the stage drives with the accent: light bars, rev lights, LED strips */
export function accentMaterials(model) {
  const out = new Set();
  if (model.lightBarMaterial) out.add(model.lightBarMaterial);
  for (const m of model.accentMaterials || []) out.add(m);
  return [...out];
}

export function createLights(THREE, scene) {
  const key = new THREE.DirectionalLight(ICE, 2.3);
  key.position.set(-3.6, 4.8, 5.2);
  const rim = new THREE.DirectionalLight(COOL, 2.6);
  rim.position.set(4.2, 2.4, -4.6);
  const rim2 = new THREE.DirectionalLight(COOL, 1.1);
  rim2.position.set(-4.8, -0.6, -3.4);
  const fill = new THREE.DirectionalLight(0xdfe6f2, 0.5);
  fill.position.set(3.2, -2.4, 3.6);
  // accent spill: scene-level and always present, so hiding a model never changes the light count (no recompiles)
  const spill = [0, 1].map(() => new THREE.PointLight(ACCENT, 0, 2, 2));
  scene.add(key, rim, rim2, fill, ...spill);
  return { key, rim, rim2, fill, spill };
}

export function createEnvironment(THREE, renderer, scene, RoomEnvironment) {
  const pmrem = new THREE.PMREMGenerator(renderer);
  let rt = null;
  const build = () => {
    if (rt) rt.dispose();
    const room = new RoomEnvironment();
    rt = pmrem.fromScene(room, 0.04);
    room.dispose();
    scene.environment = rt.texture;
  };
  build();
  scene.environmentIntensity = 0.42;
  return { rebuild: build, dispose() { if (rt) rt.dispose(); pmrem.dispose(); } };
}

/* ── glow: camera-facing additive quads in one instanced draw (light-bar cores + blooms, halo) ── */
const GLOW_VS = /* glsl */`
  attribute vec3 iOff; attribute vec3 iSz;
  varying vec2 vQ; varying float vKind, vGain;
  void main() {
    vec4 mv = modelViewMatrix * vec4(iOff, 1.);
    float s = iSz.x * length(modelMatrix[0].xyz);
    mv.xy += position.xy * s;
    vQ = position.xy * 2.; vKind = iSz.y; vGain = iSz.z;
    gl_Position = projectionMatrix * mv;
  }`;
const GLOW_FS = /* glsl */`
  uniform vec3 uCol, uHot; uniform float uPow;
  varying vec2 vQ; varying float vKind, vGain;
  void main() {
    float d2 = dot(vQ, vQ);
    if (d2 > 1.) discard;
    float a = vKind < .5 ? exp(-d2 * 9.) : (vKind < 1.5 ? exp(-d2 * 3.2) * .35 : exp(-d2 * 2.4) * .16);
    vec3 c = vKind < .5 ? mix(uCol, uHot, exp(-d2 * 22.)) : uCol;
    a *= uPow * vGain * (1. - d2);
    gl_FragColor = vec4(c * a, a);
    #include <colorspace_fragment>
  }`;
export function createGlow(THREE, items, { hot = '#eaffe9' } = {}) {
  const base = new THREE.PlaneGeometry(1, 1);
  const g = new THREE.InstancedBufferGeometry();
  g.index = base.index;
  g.setAttribute('position', base.getAttribute('position'));
  const off = new Float32Array(items.length * 3), sz = new Float32Array(items.length * 3);
  items.forEach((it, i) => { off.set([it.p.x, it.p.y, it.p.z], i * 3); sz.set([it.size, it.kind, it.gain ?? 1], i * 3); });
  g.setAttribute('iOff', new THREE.InstancedBufferAttribute(off, 3));
  g.setAttribute('iSz', new THREE.InstancedBufferAttribute(sz, 3));
  g.instanceCount = items.length;
  const m = new THREE.ShaderMaterial({
    uniforms: { uCol: { value: new THREE.Color(ACCENT) }, uHot: { value: new THREE.Color(hot) }, uPow: { value: 0 } },
    vertexShader: GLOW_VS, fragmentShader: GLOW_FS,
    transparent: true, depthWrite: false, premultipliedAlpha: true,
    blending: THREE.CustomBlending, blendSrc: THREE.OneFactor, blendDst: THREE.OneFactor,
    blendSrcAlpha: THREE.OneFactor, blendDstAlpha: THREE.OneMinusSrcAlphaFactor,
  });
  const mesh = new THREE.Mesh(g, m);
  mesh.frustumCulled = false;
  mesh.renderOrder = 5;
  return { mesh, material: m, dispose() { g.dispose(); base.dispose(); m.dispose(); } };
}

/* ── contact shadow: a soft elliptical shade under the object (only reads on paper) ── */
export function createShadow(THREE) {
  const g = new THREE.PlaneGeometry(1, 1);
  const m = new THREE.ShaderMaterial({
    uniforms: { uOp: { value: 0 } },
    vertexShader: 'varying vec2 vQ; void main(){ vQ = position.xy * 2.; gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.); }',
    fragmentShader: /* glsl */`
      uniform float uOp; varying vec2 vQ;
      void main() {
        float d2 = dot(vQ, vQ);
        if (d2 > 1.) discard;
        float a = (exp(-d2 * 7.) * .6 + exp(-d2 * 2.2) * .4) * (1. - d2) * uOp;
        gl_FragColor = vec4(0., 0., 0., a);
      }`,
    transparent: true, depthWrite: false,
  });
  const mesh = new THREE.Mesh(g, m);
  mesh.frustumCulled = false;
  mesh.renderOrder = -5;
  return { mesh, material: m, dispose() { g.dispose(); m.dispose(); } };
}

/* ── particle dissolve: every model material discards fragments behind a sweeping, noisy front and
   burns a green edge there. The key (0..1) must match morph.js → dissolveKey() on the CPU. ── */
export function createDissolveUniforms(THREE) {
  return {
    uDisInv: { value: new THREE.Matrix4() },
    uDisAxis: { value: new THREE.Vector3(0, 1, 0) },
    uDisR: { value: 1 },
    uDis: { value: 0 },
    uDisMode: { value: 0 }, // 0 off, 1 dissolving away (discard key < uDis), 2 forming (discard key > uDis)
    uDisCol: { value: new THREE.Color(ACCENT) },
  };
}
const DIS_HEAD = /* glsl */`
uniform mat4 uDisInv; uniform vec3 uDisAxis, uDisCol; uniform float uDisR, uDis, uDisMode;
varying vec3 vDisW;
float disNoise(vec3 p) {
  return .5 + (sin(p.x * 1.31 + sin(p.y * 1.73) * 1.7) + sin(p.y * 1.13 + sin(p.z * 1.57) * 1.9) + sin(p.z * 1.47 + sin(p.x * 1.21) * 1.3)) / 6.;
}
float disKey() {
  vec3 p = (uDisInv * vec4(vDisW, 1.)).xyz;
  float sw = clamp(dot(p, uDisAxis) / (2. * uDisR) + .5, 0., 1.);
  return clamp(sw * .8 + disNoise(p * 10.) * .2, 0., 1.);
}
`;
export function patchDissolve(THREE, material, U) {
  const prev = material.onBeforeCompile;
  const own = prev && prev !== THREE.Material.prototype.onBeforeCompile ? prev : null;
  const prevKey = material.customProgramCacheKey ? material.customProgramCacheKey() : '';
  material.onBeforeCompile = function (s, r) {
    if (own) own.call(this, s, r);
    Object.assign(s.uniforms, U);
    s.vertexShader = 'varying vec3 vDisW;\n' + s.vertexShader.replace('#include <project_vertex>', `#include <project_vertex>
      #ifdef USE_INSTANCING
        vDisW = (modelMatrix * instanceMatrix * vec4(transformed, 1.)).xyz;
      #else
        vDisW = (modelMatrix * vec4(transformed, 1.)).xyz;
      #endif`);
    s.fragmentShader = DIS_HEAD + s.fragmentShader
      .replace('#include <clipping_planes_fragment>', `#include <clipping_planes_fragment>
        float disK = 0.;
        if (uDisMode > .5) { disK = disKey(); if (uDisMode < 1.5 ? disK < uDis : disK > uDis) discard; }`)
      .replace('#include <emissivemap_fragment>', `#include <emissivemap_fragment>
        if (uDisMode > .5) totalEmissiveRadiance += uDisCol * (1. - smoothstep(0., .045, abs(disK - uDis))) * 3.5;`);
  };
  material.customProgramCacheKey = () => `mxdis|${prevKey}`;
  material.needsUpdate = true;
}
