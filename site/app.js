// flybrain-live: page controller. Loads the per-neuron arrays, builds the scene immediately (the dim brain is visible
// while the 30 MB connectome streams into the worker), then wires the controls, readouts, raster and capture hooks.
import { BrainScene } from './scene.js';
import { Raster } from './raster.js';

const $ = (s) => document.querySelector(s);
const qs = new URLSearchParams(location.search);
const CAPTURE = qs.has('capture');
if (CAPTURE) document.body.classList.add('capture');
const DT_MS = 0.1;
const PRESETS = { sugar: [['sugar', 100]], water: [['water', 200]], bitter: [['bitter', 200]], 'sugar+bitter': [['sugar', 100], ['bitter', 200]], none: [] };
const REF_KEY = { sugar: 'sugar_100', water: 'water_200', bitter: 'bitter_200', 'sugar+bitter': 'sugar_100__bitter_200' };
const MARK_KIND = { sugar: 0, water: 1, bitter: 2 };
const reduceMotion = window.matchMedia('(prefers-reduced-motion: reduce)').matches;
const fmt = (x, d = 0) => x.toLocaleString('en-US', { minimumFractionDigits: d, maximumFractionDigits: d });

const state = { stim: 'none', drive: 1, speed: +(qs.get('speed') ?? (reduceMotion ? 0.05 : 0.1)), paused: false, lines: qs.get('lines') !== '0', ready: false, focus: false };
let meta = null, ref = null, scene = null, raster = null, worker = null;
let tBase = 0, simTarget = 0, lastFrameWall = performance.now(), simNow = 0;
let key = null;                       // key neuron indices
const mn9 = { contra: [], ipsi: [] };  // recent MN9 spike times (ms)
let rate = { contra: 0, ipsi: 0 }, shownRate = 0;
let engine = { rtf: 0, active: 0, total: 0 };
const spkLog = [];                    // [simMs, count] per frame for spikes/s
let markAct = [0, 0, 0, 0, 0, 0];
let signArr = null, tips = null;

// ------------------------------------------------------------------ loading
function setLoading(title, frac, note) {
  if (title) $('#ldTitle').textContent = title;
  $('#ldFill').style.width = `${Math.round(Math.min(1, frac) * 100)}%`;
  if (note) $('#ldNote').textContent = note;
}
async function fetchJson(url) { const r = await fetch(url); if (!r.ok) throw new Error(`${url}: ${r.status}`); return r.json(); }
async function fetchGz(url) {
  const r = await fetch(url); if (!r.ok) throw new Error(`${url}: ${r.status}`);
  return new Response(r.body.pipeThrough(new DecompressionStream('gzip'))).arrayBuffer();
}

async function boot() {
  if (!window.WebGL2RenderingContext) throw new Error('WebGL2 is required');
  setLoading('Placing 138,639 neurons…', 0.02);
  [meta, ref] = await Promise.all([fetchJson('data/meta.json'), fetchJson('data/reference.json').catch(() => null)]);
  const buf = await fetchGz('data/neurons.bin.gz');
  setLoading('Placing 138,639 neurons…', 0.1);
  const N = meta.N, S = meta.sections;
  const sec = (name, T, len) => new T(buf, S[name].offset, len);
  const q = sec(qs.get('pos') === 'anchor' ? 'pos_anchor' : 'pos_soma', Uint16Array, N * 3);   // default: cell bodies (backbone anchor where a neuron has none)
  const cls = sec('super_class', Uint8Array, N), nt = sec('nt', Uint8Array, N), sgn = sec('sign', Uint8Array, N), side = sec('side', Uint8Array, N), ctype = sec('cell_type', Uint16Array, N);
  signArr = sgn; tips = { cls, nt, side, ctype };
  const lo = meta.bbox_um.lo, hi = meta.bbox_um.hi;
  const pos = new Float32Array(N * 3);
  for (let i = 0; i < N; i++) for (let a = 0; a < 3; a++) pos[3 * i + a] = (lo[a] + q[3 * i + a] / 65535 * (hi[a] - lo[a])) / 100;   // 1 scene unit = 100 um
  key = meta.key;

  scene = new BrainScene($('#gl'), { n: N, pos, cls, sign: sgn, nt, capture: CAPTURE, maxDpr: qs.has('dpr') ? +qs.get('dpr') : 2 });
  scene.setMarkers([{ kind: 0, ids: key.sugar }, { kind: 1, ids: key.water }, { kind: 2, ids: key.bitter }, { kind: 3, ids: [key.mn9_contra] }, { kind: 4, ids: [key.mn9_ipsi] }]);
  { // visual tuning overrides: ?base=0.4&size=2&boost=14&gain=1.5&tau=14&bloom=1&bloomR=.5&bloomT=.2&lineA=.5
    const U = scene.pointUniforms, g = (k) => (qs.has(k) ? +qs.get(k) : null);
    if (g('base') !== null) U.uBase.value = g('base'); if (g('size') !== null) U.uSize.value = g('size'); if (g('boost') !== null) U.uBoost.value = g('boost');
    if (g('gain') !== null) U.uGain.value = g('gain'); if (g('tau') !== null) U.uTau.value = g('tau'); if (g('bloom') !== null) scene.bloom.strength = g('bloom');
    if (g('bloomR') !== null) scene.bloom.radius = g('bloomR'); if (g('bloomT') !== null) scene.bloom.threshold = g('bloomT'); if (g('lineA') !== null) scene.lineUniforms.uAlpha.value = g('lineA');
  }
  raster = new Raster($('#raster'), { windowMs: 400, nRows: 100, signOf: (id) => signArr[id] });
  raster.setPinned([{ id: key.mn9_contra, label: 'MN9', color: '#fff3d6' }, { id: key.mn9_ipsi, label: "MN9'", color: '#ffd28a' }]);
  setupTags();
  homeView();
  requestAnimationFrame(frameLoop);

  setLoading('Downloading the connectome…', 0.12, 'FlyWire v783, 15.1 M connections, 30.7 MB (gzip), decoded locally');
  const lite = qs.get('graph') === 'lite' || (navigator.deviceMemory && navigator.deviceMemory <= 2);
  worker = new Worker('worker.js', { type: 'module' });
  worker.onmessage = onWorker;
  worker.onerror = (e) => fail(e.message || 'worker error');
  worker.postMessage({ type: 'init', graphUrl: lite ? 'data/graph_lite.fbg.gz' : 'data/graph_full.fbg.gz', key, seed: +(qs.get('seed') ?? 1), capture: CAPTURE });
  if (lite) $('#nE').textContent = '7.6 million';
  fillAbout();
}

function fail(msg) {
  setLoading('This browser could not start the simulation.', 1, String(msg));
  $('#ldFill').style.background = '#ff5c8a';
}

function onWorker(e) {
  const m = e.data;
  if (m.type === 'progress') {
    if (m.phase === 'download') setLoading('Downloading the connectome…', 0.12 + 0.68 * (m.total ? m.loaded / m.total : 0.5), `${fmt(m.loaded / 1e6, 1)} / ${m.total ? fmt(m.total / 1e6, 1) : '?'} MB`);
    else if (m.phase === 'decode') setLoading('Wiring up 15.1 million synapses…', 0.86, 'decoding on a background thread');
  } else if (m.type === 'ready') {
    state.ready = true;
    window.__fb = { N: m.N, E: m.E, graphBytes: m.bytes };
    setLoading('Ready', 1);
    $('#loading').classList.add('done'); setTimeout(() => { $('#loading').style.display = 'none'; }, 900);
    document.querySelectorAll('.key').forEach(b => { b.disabled = false; });
    if (!CAPTURE && !qs.get('stim')) document.querySelector('.key[data-stim="sugar"]').classList.add('hint');
    worker.postMessage({ type: 'speed', value: state.speed });
    if (CAPTURE) window.__capReady?.();
    const s0 = (qs.get('stim') || '').replace(' ', '+'); if (s0 && PRESETS[s0]) setStim(s0);
  } else if (m.type === 'frame') onFrame(m);
  else if (m.type === 'error') fail(m.message);
}

// ------------------------------------------------------------------ simulation stream
let capWaiters = new Map();
function onFrame(m) {
  const n = m.ids.length;
  const tms = new Float32Array(n);
  for (let k = 0; k < n; k++) tms[k] = m.steps[k] * DT_MS - tBase;
  if (m.reset) { scene.clearFlashes(); raster.clear(); mn9.contra.length = 0; mn9.ipsi.length = 0; spkLog.length = 0; simTarget = 0; tBase = 0; }
  scene.addSpikes(m.ids, tms);
  raster.push(m.ids, tms);
  for (let k = 0; k < n; k++) { const id = m.ids[k]; if (id === key.mn9_contra) mn9.contra.push(tms[k]); else if (id === key.mn9_ipsi) mn9.ipsi.push(tms[k]); }
  if (m.eSrc.length && state.lines) { const et = new Float32Array(m.eSrc.length); for (let k = 0; k < et.length; k++) et[k] = m.eStep[k] * DT_MS - tBase; scene.addEdges(m.eSrc, m.eDst, et); }
  simTarget = m.step * DT_MS - tBase;
  lastFrameWall = performance.now();
  spkLog.push([simTarget, n]);
  engine.rtf = m.rtf || engine.rtf; engine.active = m.active; engine.total = m.total;
  if (m.reqId !== undefined) { const w = capWaiters.get(m.reqId); if (w) { capWaiters.delete(m.reqId); w(); } }
  if (simTarget > 150000) rebase(100000);
}
function rebase(ms) {
  tBase += ms; simTarget -= ms; scene.rebase(ms); raster.t.forEach((v, i, a) => { a[i] = v - ms; });
  for (const k of ['contra', 'ipsi']) mn9[k] = mn9[k].map(t => t - ms);
  for (const e of spkLog) e[0] -= ms; raster.onset -= ms;
}

// ------------------------------------------------------------------ stimulus & controls
function groupsFor(name) { return PRESETS[name].map(([g, hz]) => ({ name: g, hz: hz * state.drive })); }
function setStim(name) {
  state.stim = name;
  document.querySelectorAll('.key.hint').forEach(b => b.classList.remove('hint'));
  document.querySelectorAll('.key').forEach(b => b.setAttribute('aria-pressed', String(b.dataset.stim === name)));
  const groups = groupsFor(name);
  worker?.postMessage({ type: 'stim', groups });
  raster?.setOnset(simNow);
  raster?.setExcluded(new Set(groups.flatMap(g => key[g.name])));
  updateReferenceBand();
}
function updateReferenceBand() {
  const band = $('#band'), note = $('#refNote');
  const r = ref && REF_KEY[state.stim] && ref.presets?.[REF_KEY[state.stim]];
  const custom = Math.abs(state.drive - 1) > 1e-6;
  if (!r || custom) { band.hidden = true; note.textContent = state.stim === 'none' ? 'reference: none' : (custom ? 'custom drive: no reference' : 'reference: none'); return; }
  const m = r.contra.mean, sd = r.contra.sd;
  note.textContent = `Brian2 ${fmt(m, 1)} ± ${fmt(sd, 1)} Hz`;
  if (m + sd < 0.3) { band.hidden = true; return; }
  const a = Math.max(0, m - sd), b = Math.min(100, m + sd);
  band.hidden = false; band.style.left = `${a}%`; band.style.width = `${Math.max(1.2, b - a)}%`;
}
function wireUI() {
  document.querySelectorAll('.key').forEach(b => { b.disabled = true; b.addEventListener('click', () => setStim(b.dataset.stim)); });
  const drive = $('#drive');
  drive.addEventListener('input', () => { state.drive = +drive.value; $('#driveOut').textContent = `×${state.drive.toFixed(2)}`; if (state.ready) { worker.postMessage({ type: 'stim', groups: groupsFor(state.stim) }); updateReferenceBand(); } });
  document.querySelectorAll('[data-speed]').forEach(b => {
    b.setAttribute('aria-pressed', String(+b.dataset.speed === state.speed));
    b.addEventListener('click', () => setSpeed(+b.dataset.speed));
  });
  $('#btnPause').addEventListener('click', togglePause);
  $('#btnReset').addEventListener('click', resetSim);
  $('#btnLines').addEventListener('click', toggleLines);
  $('#btnAbout').addEventListener('click', () => toggleDrawer());
  $('#btnClose').addEventListener('click', () => toggleDrawer(false));
  $('#btnFocus').addEventListener('click', toggleFocus);
  window.addEventListener('keydown', (e) => {
    if (e.target.matches('input, textarea')) return;
    if (e.metaKey || e.ctrlKey || e.altKey) return;
    const k = e.key.toLowerCase();
    if (k === '1' && state.ready) setStim('sugar'); else if (k === '2' && state.ready) setStim('water'); else if (k === '3' && state.ready) setStim('bitter');
    else if (k === '4' && state.ready) setStim('sugar+bitter'); else if (k === '0' && state.ready) setStim('none');
    else if (k === ' ') { e.preventDefault(); togglePause(); } else if (k === 'r') resetSim(); else if (k === 'f') toggleFocus();
    else if (k === 'l') toggleLines(); else if (k === 'i') toggleDrawer(); else if (k === 'escape') toggleDrawer(false);
  });
}
function setSpeed(v) { state.speed = v; worker?.postMessage({ type: 'speed', value: v }); document.querySelectorAll('[data-speed]').forEach(b => b.setAttribute('aria-pressed', String(+b.dataset.speed === v))); }
function togglePause() { state.paused = !state.paused; $('#btnPause').setAttribute('aria-pressed', String(state.paused)); $('#btnPause span').textContent = state.paused ? 'Play' : 'Pause'; worker?.postMessage({ type: 'pause', value: state.paused }); }
function resetSim() { if (!state.ready) return; worker.postMessage({ type: 'reset', seed: +(qs.get('seed') ?? 1) }); worker.postMessage({ type: 'stim', groups: groupsFor(state.stim) }); }
function toggleLines() { state.lines = !state.lines; $('#btnLines').setAttribute('aria-pressed', String(state.lines)); scene.setLinesVisible(state.lines); }
function toggleDrawer(force) {
  const d = $('#drawer'); const open = force ?? !d.classList.contains('open');
  d.classList.toggle('open', open); d.setAttribute('aria-hidden', String(!open)); $('#btnAbout').setAttribute('aria-expanded', String(open));
  if (open) d.focus({ preventScroll: true });
}
function homeView() {
  scene.setCamera({ target: scene.vec(0).set(0.0, -0.35, 0.1), distance: scene.homeDist, azimuth: 0.28, polar: 1.28 });
}
function toggleFocus() {
  state.focus = !state.focus;
  $('#btnFocus span').textContent = state.focus ? 'Whole brain' : 'Focus feeding circuit';
  if (state.focus) {
    const c = scene.centroid([...key.sugar, key.mn9_contra, key.mn9_ipsi]);
    scene.flyTo({ target: c, distance: 5.4, azimuth: 0.55, polar: 1.32 }, 2200);
  } else scene.flyTo({ target: scene.vec(0).set(0.0, -0.35, 0.1), distance: scene.homeDist, azimuth: scene.getCameraState().azimuth, polar: 1.28 }, 2200);
}

// ------------------------------------------------------------------ labels, tooltip, about
const tagEls = {};
function setupTags() {
  const host = $('#tags');
  const mk = (id, html, dx, dy, ang, len) => { const el = document.createElement('div'); el.className = 'tag hide'; el.style.setProperty('--len', len || '2.4rem'); el.style.setProperty('--dx', dx); el.style.setProperty('--dy', dy); el.style.setProperty('--ang', ang); el.innerHTML = `<span>${html}</span>`; host.appendChild(el); tagEls[id] = el; };
  mk('sugar', `SUGAR GRNs<small>21 taste neurons</small>`, '4.2rem', '-5.1rem', '-50deg', '4.9rem');
  mk('water', `WATER GRNs<small>18 taste neurons</small>`, '-12.2rem', '-5.4rem', '-130deg', '4.9rem');
  mk('bitter', `BITTER GRNs<small>21 taste neurons</small>`, '4.4rem', '3.9rem', '48deg', '5.3rem');
  mk('mn9', `MN9<small>lifts the proboscis</small>`, '-11.4rem', '3.2rem', '132deg', '4.4rem');
}
function updateTags() {
  const act = new Set(PRESETS[state.stim].map(p => p[0]));
  const cache = updateTags.c || (updateTags.c = {
    sugar: scene.centroid(key.sugar), water: scene.centroid(key.water), bitter: scene.centroid(key.bitter), mn9: scene.vec(key.mn9_contra),
  });
  for (const [k, el] of Object.entries(tagEls)) {
    const p = scene.project(cache[k]);
    const show = p.visible && (k === 'mn9' || act.has(k)) && state.ready;
    el.classList.toggle('hide', !show);
    if (show) el.style.transform = `translate(${p.x.toFixed(1)}px, ${p.y.toFixed(1)}px)`;
  }
}
function fillAbout() {
  const body = $('#valBody');
  if (!ref || !ref.table) { body.innerHTML = '<tr><td colspan="4">validation data not found</td></tr>'; return; }
  const cell = (c) => c ? `${fmt(c.mean, 1)} ± ${fmt(c.sd, 1)}` : '&ndash;';
  body.innerHTML = ref.table.map(r => `<tr><td>${r.label}</td><td>${cell(r.authors)}</td><td>${cell(r.brian2)}</td><td>${cell(r.js)}</td></tr>`).join('');
  $('#valNote').innerHTML = ref.note || '';
}
function wireHover() {
  const tip = $('#tip'); let last = 0;
  const cv = $('#gl');
  cv.addEventListener('pointermove', (e) => {
    if (e.pointerType !== 'mouse' || e.buttons) { tip.hidden = true; return; }
    const now = performance.now(); if (now - last < 60) return; last = now;
    const id = scene.pick(e.clientX, e.clientY);
    if (id < 0) { tip.hidden = true; return; }
    const ct = tips.ctype[id], name = ct ? meta.types[ct - 1] : 'unlabelled';
    const sc = tips.cls[id] === 255 ? '?' : meta.super_class_names[tips.cls[id]].replace(/_/g, ' ');
    const nt = tips.nt[id] === 255 ? 'unknown transmitter' : meta.nt_names[tips.nt[id]];
    const sd = tips.side[id] === 255 ? '' : ` &middot; ${meta.side_names[tips.side[id]]}`;
    const sign = ['', 'excitatory', 'inhibitory'][signArr[id]] || '';
    const firing = simNow - scene.lastSpike[id] < 40 ? ' <b>spiking</b>' : '';
    tip.innerHTML = `<b>${name}</b>${firing}<br><i>${sc}${sd} &middot; ${nt}${sign ? ' &middot; ' + sign : ''}</i>`;
    tip.hidden = false; tip.style.left = `${e.clientX}px`; tip.style.top = `${e.clientY}px`;
  });
  cv.addEventListener('pointerleave', () => { tip.hidden = true; });
}

// ------------------------------------------------------------------ per-frame
let lastUi = 0, wasRate = 0;
function windowRate(arr, now, w = 400) {
  let c = 0; for (let i = arr.length - 1; i >= 0; i--) { if (arr[i] >= now - w) c++; else break; }
  while (arr.length && arr[0] < now - 2000) arr.shift();
  return c / (w / 1000);
}
function frameLoop(tw) {
  requestAnimationFrame(frameLoop);
  if (CAPTURE) return;                       // capture mode renders only on request
  renderFrame(tw / 1000, performance.now());
}
function renderFrame(timeSec, nowWall, exact) {
  if (exact) simNow = simTarget; else {
    const ahead = state.paused ? 0 : Math.min((nowWall - lastFrameWall) * state.speed, 30);
    simNow = simTarget + ahead;
  }
  scene.setSimTime(simNow);
  // marker activity eased toward the preset
  const want = [0, 0, 0, 0, 0, 0]; for (const [g] of PRESETS[state.stim]) want[MARK_KIND[g]] = 1;
  want[3] = want[4] = 0.6;
  markAct = markAct.map((v, i) => v + (want[i] - v) * 0.12);
  scene.setMarkerActivity(markAct);
  scene.render(timeSec);
  updateTags();
  if (nowWall - lastUi > 70 || exact) { lastUi = nowWall; updateReadouts(); raster.update(simNow); }
}
function updateReadouts(exact) {
  rate.contra = windowRate(mn9.contra, simNow); rate.ipsi = windowRate(mn9.ipsi, simNow);
  shownRate = exact === 'snap' ? rate.contra : shownRate + (rate.contra - shownRate) * 0.35;
  const r = Math.max(0, shownRate);
  $('#mn9Rate').textContent = fmt(r < 0.5 ? 0 : r);
  $('#fill').style.width = `${Math.min(100, r)}%`;
  $('#meter').setAttribute('aria-valuenow', String(Math.round(r)));
  $('#sIpsi').textContent = `${fmt(rate.ipsi)} Hz`;
  $('#prob').style.setProperty('--ext', (0.28 + 0.95 * Math.min(r, 100) / 100).toFixed(3));
  $('#sTime').textContent = `${fmt(Math.max(0, simNow + tBase) / 1000, 3)} s`;
  while (spkLog.length && spkLog[0][0] < simNow - 250) spkLog.shift();
  let c = 0; for (const e of spkLog) c += e[1];
  $('#sSpk').textContent = fmt(c * 4);
  const set = new Set(); for (const i of raster.recent(simNow - 100)) set.add(raster.id[i]);
  $('#sAct').textContent = fmt(set.size);
  $('#sRtf').textContent = !state.ready ? '–' : (engine.active > 1500 ? `${fmt(engine.rtf, 1)}× real time · playing ${state.speed}×` : `idle · playing ${state.speed}×`);
}

// ------------------------------------------------------------------ capture hooks (deterministic frames for video)
if (CAPTURE) {
  window.__capReady = null;
  window.__capture = {
    ready: new Promise(res => { window.__capReady = res; }),
    state,
    setStim, setSpeed,
    setCamera: (c) => { scene.setCamera({ target: scene.vec(0).set(c.target[0], c.target[1], c.target[2]), distance: c.distance, azimuth: c.azimuth, polar: c.polar }); },
    advance(steps) {
      return new Promise(res => { const id = (advance.n = (advance.n || 0) + 1); capWaiters.set(id, res); worker.postMessage({ type: 'advance', steps, reqId: id }); });
    },
    render(timeSec, snap) { scene.controls.autoRotate = false; renderFrame(timeSec ?? 0, performance.now(), true); if (snap) updateReadouts('snap'); },
    setCaption(html) { const c = $('#caption'); c.innerHTML = html || ''; c.classList.toggle('on', !!html); },
    feedingCentroid: () => { const c = scene.centroid([...key.sugar, key.mn9_contra, key.mn9_ipsi]); return [c.x, c.y, c.z]; },
    homeDist: () => scene.homeDist,
    simTime: () => simNow,
    mn9: () => ({ contra: rate.contra, ipsi: rate.ipsi }),
  };
  const advance = window.__capture.advance;
}

wireUI();
boot().catch(err => { console.error(err); fail(err.message); });
wireHoverWhenReady();
function wireHoverWhenReady() { const t = setInterval(() => { if (scene && tips) { clearInterval(t); wireHover(); } }, 100); }
