/* ═══════════════════════════════════════════════════════════════
   V4 WebGL stage: the VR portal. A screen-space circle (drawn first, behind the headset) through which a
   procedural "virtual world" shows: a neon grid racing toward a striped sun behind green ridges.
   One quad sized to the circle; no textures. Tier 1 freezes time (a static reveal).
   ═══════════════════════════════════════════════════════════════ */
const VS = /* glsl */`
  uniform vec2 uRes, uC; uniform float uR;
  varying vec2 vQ;
  void main() {
    vQ = position.xy * 1.16;
    vec2 px = uC + vQ * uR;
    gl_Position = vec4(px / uRes * 2. - 1., .9999, 1.); // far plane: the headset occludes it
  }`;
const FS = /* glsl */`
  uniform float uR, uTime, uOpen;
  uniform vec2 uLook;
  uniform vec3 uAcc;
  varying vec2 vQ;
  float h21(vec2 p) { return fract(sin(dot(p, vec2(127.1, 311.7))) * 43758.5453); }
  float ridge(float x) {
    return .5 * (sin(x * 1.7) * .5 + .5) + .3 * (sin(x * 4.3 + 1.3) * .5 + .5) + .14 * (sin(x * 9.7 + 2.1) * .5 + .5) + .06 * (sin(x * 23. + .7) * .5 + .5);
  }
  void main() {
    float r = length(vQ);
    float px = 1. / max(uR, 1.);
    if (r > 1.16) discard;
    vec2 v = vQ * .7 + uLook * vec2(.32, .14);
    vec3 rd = normalize(vec3(v.x, v.y + .1, -1.));
    vec3 deep = vec3(.004, .016, .008);
    // sky
    vec3 col = mix(uAcc * .16 + vec3(.01, .03, .015), deep, smoothstep(0., .45, rd.y));
    vec2 sp = rd.xy / -rd.z * 70.;
    vec2 cell = floor(sp);
    float star = step(.988, h21(cell)) * smoothstep(.05, .25, rd.y);
    col += star * (.35 + .65 * h21(cell + 7.)) * (.6 + .4 * sin(uTime * 2.4 + h21(cell) * 40.));
    // striped sun on the horizon
    vec2 sc = rd.xy / -rd.z - vec2(0., .12);
    float sd = length(sc);
    float sun = 1. - smoothstep(.235, .235 + px * 2.4, sd);
    float band = sc.y + .02 + fract(uTime * .05) * .06;
    float cut = step(.0, sc.y + .05) + step(.45, fract(band * 16.));
    sun *= clamp(cut, 0., 1.) * step(0., rd.y);
    vec3 sunCol = mix(uAcc * 1.25, vec3(.82, 1., .78), smoothstep(-.12, .2, sc.y));
    col = mix(col, sunCol, sun);
    col += uAcc * .32 * exp(-sd * 4.2) * step(0., rd.y);
    // ridges
    float az = atan(rd.x, -rd.z);
    float mh = ridge(az * 2.6 + 1.1) * .085 + .006;
    if (rd.y > 0. && rd.y < mh) col = mix(vec3(.003, .012, .006), uAcc * .05, rd.y / mh);
    col += uAcc * 1.1 * (1. - smoothstep(0., .0035 + px * .8, abs(rd.y - mh))) * step(0., rd.y);
    // grid floor racing toward the sun
    if (rd.y < 0.) {
      float t = .55 / -rd.y;
      vec2 g = vec2(rd.x * t, -rd.z * t + uTime * 1.6);
      vec2 w = fwidth(g) * 1.3;
      vec2 dl = abs(fract(g + .5) - .5);
      float line = max(1. - smoothstep(0., w.x + .012, dl.x), 1. - smoothstep(0., w.y + .012, dl.y));
      float fog = exp(-t * .09);
      col = mix(deep, vec3(.0, .03, .012), fog) + uAcc * line * (.25 + 1.25 * fog);
      col += uAcc * .35 * exp(-(-rd.y) * 26.);
    }
    // scanlines and lens falloff
    col *= .9 + .1 * sin(gl_FragCoord.y * 1.6);
    col *= mix(1., .45, smoothstep(.55, 1., r));
    float inside = 1. - smoothstep(1. - px * 1.5, 1. + px * .5, r);
    float ring = exp(-pow((r - 1.) / (px * 2.2 + .006), 2.)) * .9 + exp(-pow((r - 1.) / .07, 2.)) * .22;
    vec3 c = col * inside + uAcc * ring;
    float a = clamp(inside + ring * .9, 0., 1.) * uOpen;
    gl_FragColor = vec4(c * uOpen, a);
    #include <colorspace_fragment>
  }`;

export function createPortal(THREE, { accent }) {
  const g = new THREE.PlaneGeometry(2, 2);
  const material = new THREE.ShaderMaterial({
    uniforms: {
      uRes: { value: new THREE.Vector2(1, 1) }, uC: { value: new THREE.Vector2() }, uR: { value: 100 },
      uTime: { value: 0 }, uOpen: { value: 0 }, uLook: { value: new THREE.Vector2() }, uAcc: { value: new THREE.Color(accent) },
    },
    vertexShader: VS, fragmentShader: FS,
    transparent: true, depthWrite: false, premultipliedAlpha: true,
  });
  const mesh = new THREE.Mesh(g, material);
  mesh.frustumCulled = false;
  mesh.renderOrder = -10;
  mesh.visible = false;
  return { mesh, u: material.uniforms, dispose() { g.dispose(); material.dispose(); } };
}
