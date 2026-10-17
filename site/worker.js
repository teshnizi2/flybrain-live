// Simulation worker: downloads + decodes the connectome, owns the engine, advances it in step with the wall clock
// (or on request, in capture mode) and streams spikes to the page.
//
// in:  {type:'init', graphUrl, key, seed, capture}  {type:'stim', groups:[{name, hz}]}  {type:'speed', value}
//      {type:'pause', value}  {type:'reset', seed}  {type:'advance', steps, reqId}   (capture mode)
// out: {type:'progress', loaded, total, phase}  {type:'ready', N, E}  {type:'frame', ...spikes, edges, stats}
import { Engine, PARAMS } from './engine/lif.js';
import { decodeGraph } from './engine/graph.js';

const GROUPS = ['sugar', 'water', 'bitter', 'ir94e'];
let eng = null, key = null;
let speed = 0.1;                    // simulated seconds per wall second
let paused = false, capture = false;
let lastWall = 0, stepDebt = 0;
const samples = [];                 // {wall, sim, compute} for the engine-speed readout

function post(msg, transfer) { self.postMessage(msg, transfer || []); }

async function fetchGraph(url) {
  const resp = await fetch(url);
  if (!resp.ok) throw new Error(`graph download failed: ${resp.status}`);
  const total = +resp.headers.get('content-length') || 0;
  let loaded = 0, lastPost = 0;
  const counter = new TransformStream({
    transform(chunk, ctl) {
      loaded += chunk.byteLength;
      const now = performance.now();
      if (now - lastPost > 80) { lastPost = now; post({ type: 'progress', phase: 'download', loaded, total }); }
      ctl.enqueue(chunk);
    },
  });
  const stream = resp.body.pipeThrough(counter).pipeThrough(new DecompressionStream('gzip'));
  const buf = await new Response(stream).arrayBuffer();
  post({ type: 'progress', phase: 'download', loaded: total || loaded, total: total || loaded });
  return buf;
}

async function init(m) {
  key = m.key; capture = !!m.capture;
  const buf = await fetchGraph(m.graphUrl);
  post({ type: 'progress', phase: 'decode', loaded: 0, total: 1 });
  await new Promise(r => setTimeout(r, 0));
  const g = decodeGraph(buf);
  eng = new Engine(g, { seed: m.seed ?? 1, epsV: 1e-7, epsG: 1e-7, trackSources: true });
  post({ type: 'ready', N: g.N, E: g.E, bytes: buf.byteLength });
  lastWall = performance.now();
  if (!capture) loop();
}

function applyStim(groups) {
  for (const n of GROUPS) eng.setPoisson(n, [], 0);
  for (const gr of groups) if (gr.hz > 0) eng.setPoisson(gr.name, key[gr.name], gr.hz);
}

function emit(extra) {
  const sp = eng.takeSpikes(), ed = eng.takeEdges();
  const now = performance.now();
  while (samples.length && now - samples[0].wall > 2500) samples.shift();
  let sim = 0, comp = 0;
  for (const s of samples) { sim += s.sim; comp += s.compute; }
  const msg = {
    type: 'frame', step: eng.step, ids: sp.ids, steps: sp.steps, eSrc: ed.src, eDst: ed.dst, eStep: ed.step,
    active: eng.activeCount, total: eng.totalSpikes, rtf: comp > 0 ? sim / comp : 0, ...extra,
  };
  post(msg, [sp.ids.buffer, sp.steps.buffer, ed.src.buffer, ed.dst.buffer, ed.step.buffer]);
}

function loop() {
  const now = performance.now();
  const dtWall = Math.min(now - lastWall, 100);
  lastWall = now;
  if (!paused) {
    stepDebt = Math.min(stepDebt + dtWall * speed * 10, 3000);       // 1 ms wall at speed 1 = 10 steps of 0.1 ms
    let n = Math.floor(stepDebt);
    if (n > 0) {
      const t0 = performance.now();
      let done = 0;
      while (done < n) {
        const k = Math.min(100, n - done);
        eng.run(k); done += k;
        if (performance.now() - t0 > 14) break;                       // never hog the worker for more than ~14 ms
      }
      stepDebt -= done;
      if (stepDebt > 600) stepDebt = 600;                              // the machine can't keep up: slow down instead of spiralling
      samples.push({ wall: now, sim: done * PARAMS.dt, compute: (performance.now() - t0) / 1000 });
      emit({});
    }
  }
  // when the engine is behind the requested playback speed, go again at once; otherwise idle ~8 ms between ticks
  if (stepDebt >= 1 && !paused) tick.port2.postMessage(0); else setTimeout(loop, 8);
}
const tick = new MessageChannel();
tick.port1.onmessage = () => loop();

self.onmessage = async (e) => {
  const m = e.data;
  try {
    switch (m.type) {
      case 'init': await init(m); break;
      case 'stim': applyStim(m.groups); break;
      case 'speed': speed = m.value; break;
      case 'pause': paused = m.value; lastWall = performance.now(); break;
      case 'reset': eng.reset(m.seed); stepDebt = 0; samples.length = 0; emit({ reset: true }); break;
      case 'advance': {                                              // deterministic stepping for ?capture=1
        const t0 = performance.now();
        eng.run(m.steps);
        samples.length = 0;
        samples.push({ wall: performance.now(), sim: m.steps * PARAMS.dt, compute: (performance.now() - t0) / 1000 });
        emit({ reqId: m.reqId });
        break;
      }
    }
  } catch (err) {
    post({ type: 'error', message: String(err && err.message || err) });
  }
};
