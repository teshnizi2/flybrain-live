// Deterministic replay of identical input events through the JS engine and Brian2 (reference/replay_brian2.py).
// Writes results/replay_summary.json. The same comparison runs as a test in tests/replay.test.mjs.
import fs from 'node:fs';
import zlib from 'node:zlib';
import { fileURLToPath } from 'node:url';
import { performance } from 'node:perf_hooks';
import { decodeGraph } from '../site/engine/graph.js';
import { Engine } from '../site/engine/lif.js';

const root = fileURLToPath(new URL('../', import.meta.url));
const raw = zlib.gunzipSync(fs.readFileSync(root + 'site/data/graph_full.fbg.gz'));
const g = decodeGraph(raw.buffer.slice(raw.byteOffset, raw.byteOffset + raw.byteLength));
const files = fs.readdirSync(root + 'results/reference').filter(f => f.startsWith('replay_783_')).sort();
const out = [];
for (const f of files) {
  const ref = JSON.parse(fs.readFileSync(root + 'results/reference/' + f, 'utf8'));
  for (const eps of [0, 1e-7]) {
    const eng = new Engine(g, { epsV: eps, epsG: eps });
    eng.setNoRefractory([...new Set(ref.events.map(e => e[1]))]);
    eng.setEventSchedule(Int32Array.from(ref.events.map(e => e[0])), Int32Array.from(ref.events.map(e => e[1])));
    const t0 = performance.now(); eng.run(ref.steps); const ms = performance.now() - t0;
    const s = eng.takeSpikes();
    let diff = 0; const n = Math.max(s.steps.length, ref.spikes.length);
    for (let k = 0; k < n; k++) if (k >= s.steps.length || k >= ref.spikes.length || s.steps[k] !== ref.spikes[k][0] || s.ids[k] !== ref.spikes[k][1]) diff++;
    out.push({ condition: ref.condition, graph: ref.graph, steps: ref.steps, seed: ref.seed, n_events: ref.n_events, brian2_spikes: ref.n_spikes, js_spikes: s.steps.length,
               mismatched_spikes: diff, identical: diff === 0, eps_volts: eps, js_wall_ms: Math.round(ms), brian2_version: ref.brian2_version });
    console.log(f, 'eps', eps, 'brian2', ref.n_spikes, 'js', s.steps.length, diff === 0 ? 'IDENTICAL' : `DIFF ${diff}`);
  }
}
const summary = { runs: out, all_identical: out.every(r => r.identical), total_spikes_per_mode: out.filter(r => r.eps_volts === 0).reduce((a, r) => a + r.brian2_spikes, 0),
                  n_conditions: out.length / 2 };
fs.writeFileSync(root + 'results/replay_summary.json', JSON.stringify(summary, null, 1));
console.log('all identical:', summary.all_identical, 'total spikes', summary.total_spikes_per_mode);
