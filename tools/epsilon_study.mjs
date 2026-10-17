// Does snapping |v - v_0| <= eps and |g| <= eps to exact rest change the simulation?
// Same seed => same Poisson stream, so any difference in the spike train is caused by eps alone.
// Writes results/epsilon_study.json.
import fs from 'node:fs';
import zlib from 'node:zlib';
import { fileURLToPath } from 'node:url';
import { performance } from 'node:perf_hooks';
import { decodeGraph } from '../site/engine/graph.js';
import { Engine } from '../site/engine/lif.js';

const root = fileURLToPath(new URL('../', import.meta.url));
const raw = zlib.gunzipSync(fs.readFileSync(root + 'site/data/graph_full.fbg.gz'));
const g = decodeGraph(raw.buffer.slice(raw.byteOffset, raw.byteOffset + raw.byteLength));
const meta = JSON.parse(fs.readFileSync(root + 'site/data/meta.json', 'utf8'));
const conds = { sugar_100: [['sugar', 100]], sugar_200: [['sugar', 200]], water_260: [['water', 260]], sugar_100__bitter_100: [['sugar', 100], ['bitter', 100]] };
const seeds = [11, 12, 13, 14, 15];
const epsList = [0, 1e-9, 1e-8, 1e-7, 1e-6, 1e-5];
function run(cond, seed, eps) {
  const e = new Engine(g, { epsV: eps, epsG: eps, seed });
  conds[cond].forEach(([grp, hz], k) => e.setPoisson('g' + k, meta.key[grp], hz));
  const t0 = performance.now(); let maxActive = 0;
  for (let c = 0; c < 10; c++) { e.run(1000); maxActive = Math.max(maxActive, e.activeCount); }
  const ms = performance.now() - t0; const s = e.takeSpikes();
  return { steps: s.steps, ids: s.ids, ms, maxActive };
}
const rows = {};
for (const eps of epsList) rows[eps] = { runs: 0, identical_runs: 0, total_spikes: 0, mismatched_spikes: 0, ms: [], max_active: [] };
for (const cond of Object.keys(conds)) for (const seed of seeds) {
  const ref = run(cond, seed, 0);
  for (const eps of epsList) {
    const r = eps === 0 ? ref : run(cond, seed, eps);
    let diff = 0; const n = Math.max(r.steps.length, ref.steps.length);
    for (let k = 0; k < n; k++) if (k >= r.steps.length || k >= ref.steps.length || r.steps[k] !== ref.steps[k] || r.ids[k] !== ref.ids[k]) diff++;
    const row = rows[eps]; row.runs++; row.identical_runs += diff === 0 ? 1 : 0; row.total_spikes += ref.steps.length; row.mismatched_spikes += diff; row.ms.push(r.ms); row.max_active.push(r.maxActive);
  }
  console.log(cond, seed, 'done', epsList.map(e => `${e}:${rows[e].mismatched_spikes}`).join(' '));
}
const out = { conditions: Object.keys(conds), seeds, sim_seconds_per_run: 1, results: Object.fromEntries(Object.entries(rows).map(([eps, r]) => [eps, {
  runs: r.runs, identical_runs: r.identical_runs, total_spikes: r.total_spikes, mismatched_spikes: r.mismatched_spikes,
  mean_ms_per_sim_second: r.ms.reduce((a, b) => a + b, 0) / r.ms.length, mean_max_active: r.max_active.reduce((a, b) => a + b, 0) / r.max_active.length }])) };
fs.writeFileSync(root + 'results/epsilon_study.json', JSON.stringify(out, null, 1));
console.log(JSON.stringify(out.results, null, 1));
