// three.js scene: 138,639 neurons as additive points at their real positions, a per-point "last spike time"
// attribute that the vertex shader turns into a flash (so the CPU only writes the neurons that spiked), cascade
// lines, ring markers for the stimulated neurons and MN9, bloom.
import * as THREE from 'three';
import { OrbitControls } from 'three/addons/controls/OrbitControls.js';
import { EffectComposer } from 'three/addons/postprocessing/EffectComposer.js';
import { RenderPass } from 'three/addons/postprocessing/RenderPass.js';
import { UnrealBloomPass } from 'three/addons/postprocessing/UnrealBloomPass.js';
import { OutputPass } from 'three/addons/postprocessing/OutputPass.js';

export const CLASS_COLORS = [      // index = meta.super_class_names; 10 = hidden / unannotated
  '#2c4a80', // optic
  '#3f9a9c', // central
  '#d8b46e', // sensory
  '#6672c0', // visual_projection
  '#a487d0', // ascending
  '#74c79a', // descending
  '#d79a74', // sensory_ascending
  '#5a86cc', // visual_centrifugal
  '#ffb347', // motor
  '#e6759c', // endocrine
  '#000000',
];
const vec3 = (c) => new THREE.Vector3(c.r, c.g, c.b);
const MARKER_COLORS = { sugar: '#f59e0b', water: '#7fd0ff', bitter: '#ff5c8a', ir94e: '#b9a4ff', mn9: '#ffffff' };

const POINT_VS = /* glsl */`
uniform float uSimNow, uTau, uSize, uBoost, uRef, uDpr, uBase, uGain, uHot, uTime;
uniform vec3 uPalette[11];
uniform vec3 uFlashE, uFlashI;
attribute float aSpike, aCls, aSign;
varying vec3 vCol;
void main() {
  vec4 mv = modelViewMatrix * vec4(position, 1.0);
  float age = uSimNow - aSpike;
  float f = age >= 0.0 ? exp(-age / uTau) : 0.0;
  f = f < 0.004 ? 0.0 : f;
  int ci = int(aCls + 0.5);
  vec3 base = uPalette[ci] * uBase * (1.0 + 0.16 * sin(uTime * 0.7 + dot(position, vec3(1.7, 1.3, 2.1))));
  vec3 fc = aSign > 1.5 ? uFlashI : uFlashE;
  float hot = smoothstep(0.30, 1.0, f);
  vec3 flashCol = mix(fc, vec3(1.0), hot * uHot) * f * uGain;
  vCol = base + flashCol;
  float s = (uSize + uBoost * f) * uRef / max(-mv.z, 0.1) * uDpr;
  gl_PointSize = ci == 10 ? 0.0 : s;
  gl_Position = projectionMatrix * mv;
}`;
const POINT_FS = /* glsl */`
varying vec3 vCol;
void main() {
  vec2 c = gl_PointCoord - 0.5;
  float d = length(c) * 2.0;
  float a = 1.0 - smoothstep(0.0, 1.0, d);
  a *= a;
  gl_FragColor = vec4(vCol * a, 1.0);
}`;
const LINE_VS = /* glsl */`
uniform float uSimNow, uTauL;
attribute float aBirth, aEnd;
varying float vA;
void main() {
  float age = uSimNow - aBirth;
  float f = (age >= 0.0 && aBirth > -1.0e8) ? exp(-age / uTauL) : 0.0;
  vA = f * mix(0.12, 1.0, aEnd);
  gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
}`;
const LINE_FS = /* glsl */`
uniform vec3 uCol; uniform float uAlpha;
varying float vA;
void main() { gl_FragColor = vec4(uCol * vA * uAlpha, 1.0); }`;
const MARK_VS = /* glsl */`
uniform float uRef, uDpr, uTime, uAct[6];
uniform vec3 uMc[6];
attribute float aKind;
varying vec3 vCol; varying float vAct, vKind;
void main() {
  vec4 mv = modelViewMatrix * vec4(position, 1.0);
  int k = int(aKind + 0.5);
  float act = uAct[k];
  vCol = uMc[k]; vAct = act; vKind = aKind;
  float pulse = 0.5 + 0.5 * sin(uTime * 5.0 + position.x * 7.0);
  float base = k >= 3 ? 21.0 : 13.0;
  gl_PointSize = (base + act * (4.0 + 3.0 * pulse)) * uRef / max(-mv.z, 0.1) * uDpr;
  gl_Position = projectionMatrix * mv;
}`;
const MARK_FS = /* glsl */`
varying vec3 vCol; varying float vAct, vKind;
void main() {
  vec2 c = gl_PointCoord - 0.5;
  float d = length(c) * 2.0;
  float ring = smoothstep(0.62, 0.72, d) * (1.0 - smoothstep(0.88, 1.0, d));
  float i = (vKind > 2.5 ? 0.62 : 0.22 + 0.75 * vAct);
  gl_FragColor = vec4(vCol * ring * i, 1.0);
}`;

export class BrainScene {
  /**
   * @param {HTMLCanvasElement} canvas
   * @param {{n:number,pos:Float32Array,cls:Uint8Array,sign:Uint8Array,nt:Uint8Array,capture?:boolean,maxDpr?:number}} o
   */
  constructor(canvas, o) {
    this.canvas = canvas; this.n = o.n; this.pos = o.pos; this.capture = !!o.capture;
    this.size = { w: Math.max(1, window.innerWidth), h: Math.max(1, window.innerHeight) };
    const renderer = this.renderer = new THREE.WebGLRenderer({ canvas, antialias: false, powerPreference: 'high-performance', preserveDrawingBuffer: this.capture });
    this.maxDpr = o.maxDpr ?? 2;
    renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, this.maxDpr));
    renderer.setClearColor(new THREE.Color('#0e1117'), 1);
    renderer.toneMapping = THREE.NoToneMapping;
    const scene = this.scene = new THREE.Scene();
    scene.background = new THREE.Color('#0e1117');
    const camera = this.camera = new THREE.PerspectiveCamera(32, 1, 0.1, 200);
    this.refDist = 13; this.homeDist = 13.2;
    camera.position.set(2.4, 3.6, 12.2);

    // ---- neuron points
    const n = this.n;
    this.lastSpike = new Float32Array(n).fill(-1e9);
    const clsF = new Float32Array(n), signF = new Float32Array(n);
    for (let i = 0; i < n; i++) {
      clsF[i] = o.cls[i] === 255 ? 10 : o.cls[i];
      const s = o.sign[i];
      signF[i] = s ? s : (o.nt[i] === 1 || o.nt[i] === 2 ? 2 : 1);   // no outgoing wiring: fall back on the annotated transmitter
    }
    const geo = this.geo = new THREE.BufferGeometry();
    geo.setAttribute('position', new THREE.BufferAttribute(this.pos, 3));
    this.spikeAttr = new THREE.BufferAttribute(this.lastSpike, 1); this.spikeAttr.setUsage(THREE.DynamicDrawUsage);
    geo.setAttribute('aSpike', this.spikeAttr);
    geo.setAttribute('aCls', new THREE.BufferAttribute(clsF, 1));
    geo.setAttribute('aSign', new THREE.BufferAttribute(signF, 1));
    geo.boundingSphere = new THREE.Sphere(new THREE.Vector3(), 20);
    const palette = CLASS_COLORS.map(h => { const c = new THREE.Color(h); return new THREE.Vector3(c.r, c.g, c.b); });
    const uni = this.pointUniforms = {
      uSimNow: { value: 0 }, uTau: { value: 14 }, uSize: { value: 1.7 }, uBoost: { value: 7 }, uRef: { value: this.refDist }, uDpr: { value: renderer.getPixelRatio() },
      uTime: { value: 0 }, uBase: { value: 0.40 }, uGain: { value: 1.15 }, uHot: { value: 0.9 }, uPalette: { value: palette },
      uFlashE: { value: vec3(new THREE.Color('#ffb43a')) },
      uFlashI: { value: vec3(new THREE.Color('#6f86ff')) },
    };
    this.points = new THREE.Points(geo, new THREE.ShaderMaterial({
      uniforms: uni, vertexShader: POINT_VS, fragmentShader: POINT_FS, transparent: true, depthTest: false, depthWrite: false, blending: THREE.AdditiveBlending,
    }));
    this.points.frustumCulled = false;
    scene.add(this.points);

    // ---- cascade lines: ring buffer of segments
    this.maxSeg = 6000; this.segHead = 0;
    const lg = this.lineGeo = new THREE.BufferGeometry();
    this.linePos = new Float32Array(this.maxSeg * 6);
    this.lineBirth = new Float32Array(this.maxSeg * 2).fill(-1e9);
    const lend = new Float32Array(this.maxSeg * 2); for (let s = 0; s < this.maxSeg; s++) lend[s * 2 + 1] = 1;
    lg.setAttribute('position', new THREE.BufferAttribute(this.linePos, 3).setUsage(THREE.DynamicDrawUsage));
    lg.setAttribute('aBirth', new THREE.BufferAttribute(this.lineBirth, 1).setUsage(THREE.DynamicDrawUsage));
    lg.setAttribute('aEnd', new THREE.BufferAttribute(lend, 1));
    lg.boundingSphere = new THREE.Sphere(new THREE.Vector3(), 20);
    this.lineUniforms = { uSimNow: uni.uSimNow, uTauL: { value: 42 }, uCol: { value: new THREE.Vector3(1.0, 0.62, 0.2) }, uAlpha: { value: 0.55 } };
    this.lines = new THREE.LineSegments(lg, new THREE.ShaderMaterial({ uniforms: this.lineUniforms, vertexShader: LINE_VS, fragmentShader: LINE_FS, transparent: true, depthTest: false, depthWrite: false, blending: THREE.AdditiveBlending }));
    this.lines.frustumCulled = false;
    scene.add(this.lines);
    this.linesOn = true;

    // ---- markers (set later)
    this.markers = null;
    this.markUniforms = { uRef: uni.uRef, uDpr: uni.uDpr, uTime: { value: 0 }, uAct: { value: [0, 0, 0, 0, 0, 0] },
      uMc: { value: ['sugar', 'water', 'bitter', 'mn9', 'mn9', 'ir94e'].map(k => { const c = new THREE.Color(MARKER_COLORS[k]); return new THREE.Vector3(c.r, c.g, c.b); }) } };

    // ---- camera controls
    const controls = this.controls = new OrbitControls(camera, canvas);
    controls.enableDamping = true; controls.dampingFactor = 0.07; controls.rotateSpeed = 0.55; controls.zoomSpeed = 0.8; controls.panSpeed = 0.6;
    controls.minDistance = 2.2; controls.maxDistance = 34;
    controls.target.set(0.0, -0.35, 0.1);
    controls.autoRotate = !this.capture && !window.matchMedia('(prefers-reduced-motion: reduce)').matches;
    controls.autoRotateSpeed = 0.42;
    this._idleTimer = 0;
    controls.addEventListener('start', () => { clearTimeout(this._idleTimer); this.controls.autoRotate = false; this._anim = null; });
    controls.addEventListener('end', () => {
      if (this.capture || window.matchMedia('(prefers-reduced-motion: reduce)').matches) return;
      this._idleTimer = setTimeout(() => { this.controls.autoRotate = true; }, 4500);
    });
    controls.update();

    // ---- post
    const composer = this.composer = new EffectComposer(renderer);
    composer.addPass(new RenderPass(scene, camera));
    this.bloom = new UnrealBloomPass(new THREE.Vector2(256, 256), 0.6, 0.55, 0.16);
    composer.addPass(this.bloom);
    composer.addPass(new OutputPass());
    this._anim = null;
    this.resize();
    this._ro = new ResizeObserver(() => this.resize());
    this._ro.observe(canvas);
  }

  resize(w, h) {
    const c = this.canvas;
    w = w ?? c.clientWidth; h = h ?? c.clientHeight;
    if (!w || !h) return;
    const dpr = Math.min(window.devicePixelRatio || 1, this.maxDpr);
    this.renderer.setPixelRatio(dpr); this.renderer.setSize(w, h, false);
    this.composer.setPixelRatio(dpr); this.composer.setSize(w, h);
    const aspect = w / h;
    this.camera.aspect = aspect;
    // portrait: widen the field of view and back the camera off so the whole brain still fits across the screen
    this.camera.fov = aspect >= 1 ? 32 : 32 + 20 * Math.min(1, (1 - aspect) / 0.55);
    const halfW = 4.9, tanH = Math.tan(this.camera.fov * Math.PI / 360);
    this.homeDist = Math.max(13.2, halfW / (tanH * aspect));
    this.refDist = this.homeDist;
    if (aspect < 0.9) this.camera.setViewOffset(w, h, 0, Math.round((w < 700 ? 0.075 : 0.05) * h), w, h); else this.camera.clearViewOffset();
    this.camera.updateProjectionMatrix();
    this.pointUniforms.uDpr.value = dpr;
    this.pointUniforms.uSize.value = 1.7 * (w < 700 ? 0.82 : 1);
    this.bloom.resolution.set(w, h);
    this.size = { w, h };
  }

  setMarkers(groups) {
    // groups: [{kind: 0..5, ids: [neuron index...]}]
    const pts = [], kinds = [];
    for (const g of groups) for (const i of g.ids) { pts.push(this.pos[3 * i], this.pos[3 * i + 1], this.pos[3 * i + 2]); kinds.push(g.kind); }
    const geo = new THREE.BufferGeometry();
    geo.setAttribute('position', new THREE.BufferAttribute(new Float32Array(pts), 3));
    geo.setAttribute('aKind', new THREE.BufferAttribute(new Float32Array(kinds), 1));
    geo.boundingSphere = new THREE.Sphere(new THREE.Vector3(), 20);
    if (this.markers) this.scene.remove(this.markers);
    this.markers = new THREE.Points(geo, new THREE.ShaderMaterial({ uniforms: this.markUniforms, vertexShader: MARK_VS, fragmentShader: MARK_FS, transparent: true, depthTest: false, depthWrite: false, blending: THREE.AdditiveBlending }));
    this.markers.frustumCulled = false;
    this.scene.add(this.markers);
  }
  setMarkerActivity(arr) { for (let k = 0; k < 6; k++) this.markUniforms.uAct.value[k] = arr[k] ?? 0; }

  setSimTime(ms) { this.pointUniforms.uSimNow.value = ms; }
  /** Mark neurons as spiking at the given sim times (ms). */
  addSpikes(ids, timesMs) {
    const L = this.lastSpike;
    for (let k = 0; k < ids.length; k++) L[ids[k]] = timesMs[k];
    if (ids.length) this.spikeAttr.needsUpdate = true;
  }
  addEdges(src, dst, timesMs, maxPerCall = 500) {
    const n = src.length; if (!n) return;
    const stride = n > maxPerCall ? n / maxPerCall : 1;
    const P = this.pos, LP = this.linePos, LB = this.lineBirth;
    for (let q = 0; q < Math.min(n, maxPerCall); q++) {
      const k = Math.floor(q * stride), a = src[k], b = dst[k], s = this.segHead;
      const o = s * 6;
      LP[o] = P[3 * a]; LP[o + 1] = P[3 * a + 1]; LP[o + 2] = P[3 * a + 2];
      LP[o + 3] = P[3 * b]; LP[o + 4] = P[3 * b + 1]; LP[o + 5] = P[3 * b + 2];
      LB[2 * s] = timesMs[k]; LB[2 * s + 1] = timesMs[k];
      this.segHead = (s + 1) % this.maxSeg;
    }
    this.lineGeo.attributes.position.needsUpdate = true; this.lineGeo.attributes.aBirth.needsUpdate = true;
  }
  setLinesVisible(on) { this.linesOn = on; this.lines.visible = on; }
  /** Subtract `ms` from every stored time (call before sim time gets large: float32 precision). */
  rebase(ms) {
    const L = this.lastSpike; for (let i = 0; i < L.length; i++) if (L[i] > -1e8) L[i] -= ms;
    for (let i = 0; i < this.lineBirth.length; i++) if (this.lineBirth[i] > -1e8) this.lineBirth[i] -= ms;
    this.spikeAttr.needsUpdate = true; this.lineGeo.attributes.aBirth.needsUpdate = true;
  }
  clearFlashes() { this.lastSpike.fill(-1e9); this.lineBirth.fill(-1e9); this.spikeAttr.needsUpdate = true; this.lineGeo.attributes.aBirth.needsUpdate = true; }

  vec(i) { return new THREE.Vector3(this.pos[3 * i], this.pos[3 * i + 1], this.pos[3 * i + 2]); }
  centroid(ids) { const v = new THREE.Vector3(); for (const i of ids) v.add(this.vec(i)); return v.multiplyScalar(1 / ids.length); }

  /** Screen position of a world point: {x, y, depth, visible}. */
  project(v) {
    const p = v.clone().project(this.camera);
    return { x: (p.x * 0.5 + 0.5) * this.size.w, y: (-p.y * 0.5 + 0.5) * this.size.h, visible: p.z < 1 && p.z > -1 };
  }
  /** Nearest neuron to a pixel (CSS px relative to the canvas), preferring flashing ones. Returns -1 if none within `radius`. */
  pick(px, py, radius = 11) {
    this.camera.updateMatrixWorld();
    const m = new THREE.Matrix4().multiplyMatrices(this.camera.projectionMatrix, this.camera.matrixWorldInverse).elements;
    const P = this.pos, L = this.lastSpike, now = this.pointUniforms.uSimNow.value, W = this.size.w, H = this.size.h;
    let best = -1, bestScore = radius * radius;
    for (let i = 0, n = this.n; i < n; i++) {
      const x = P[3 * i], y = P[3 * i + 1], z = P[3 * i + 2];
      const w = m[3] * x + m[7] * y + m[11] * z + m[15];
      if (w <= 0.1) continue;
      const sx = ((m[0] * x + m[4] * y + m[8] * z + m[12]) / w * 0.5 + 0.5) * W - px;
      if (sx > radius || sx < -radius) continue;
      const sy = (0.5 - (m[1] * x + m[5] * y + m[9] * z + m[13]) / w * 0.5) * H - py;
      let d2 = sx * sx + sy * sy;
      if (d2 > bestScore) continue;
      const age = now - L[i];
      if (age >= 0 && age < 60) d2 *= 0.25;          // a flashing neuron wins over a dim neighbour
      if (d2 < bestScore) { bestScore = d2; best = i; }
    }
    return best;
  }

  /** Smoothly move the camera (target, distance, azimuth/polar optional) in `ms` milliseconds of wall time. */
  flyTo({ target, distance, azimuth, polar }, ms = 1800) {
    const cam = this.camera, ctl = this.controls;
    const from = { t: ctl.target.clone(), off: cam.position.clone().sub(ctl.target) };
    const sph0 = new THREE.Spherical().setFromVector3(from.off);
    const sph1 = new THREE.Spherical(distance ?? sph0.radius, polar ?? sph0.phi, azimuth ?? sph0.theta);
    // shortest way round in azimuth
    let dth = sph1.theta - sph0.theta; dth = Math.atan2(Math.sin(dth), Math.cos(dth)); sph1.theta = sph0.theta + dth;
    ctl.autoRotate = false;
    this._anim = { t0: performance.now(), ms, from, sph0, sph1, to: target.clone() };
  }
  setCamera({ target, distance, azimuth, polar }) {
    const sph = new THREE.Spherical(distance, polar, azimuth);
    this.controls.target.copy(target);
    this.camera.position.copy(target).add(new THREE.Vector3().setFromSpherical(sph));
    this.camera.lookAt(target);
    this.controls.update();
  }
  getCameraState() {
    const off = this.camera.position.clone().sub(this.controls.target);
    const s = new THREE.Spherical().setFromVector3(off);
    return { target: this.controls.target.clone(), distance: s.radius, azimuth: s.theta, polar: s.phi };
  }

  render(timeSec = performance.now() / 1000) {
    const a = this._anim;
    if (a) {
      let u = (performance.now() - a.t0) / a.ms;
      if (u >= 1) { u = 1; this._anim = null; }
      const e = u < 0.5 ? 4 * u * u * u : 1 - Math.pow(-2 * u + 2, 3) / 2;
      const t = a.from.t.clone().lerp(a.to, e);
      const sph = new THREE.Spherical(a.sph0.radius + (a.sph1.radius - a.sph0.radius) * e, a.sph0.phi + (a.sph1.phi - a.sph0.phi) * e, a.sph0.theta + (a.sph1.theta - a.sph0.theta) * e);
      this.controls.target.copy(t);
      this.camera.position.copy(t).add(new THREE.Vector3().setFromSpherical(sph));
    }
    this.markUniforms.uTime.value = timeSec; this.pointUniforms.uTime.value = timeSec;
    this.controls.update();
    this.pointUniforms.uRef.value = this.refDist;
    this.composer.render();
  }
}
