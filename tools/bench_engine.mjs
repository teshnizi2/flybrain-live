// Clean speed benchmark of the engine in Node (V8, same engine code the page's worker runs).
// Real-time factor = simulated seconds / wall seconds, whole brain (138,639 neurons, 15.09 M connections), eps = 1e-7 V,
// 1 s warm-up then 5 s measured, per stimulus. Writes results/engine_speed.json.
import fs from 'node:fs';
import os from 'node:os';
import zlib from 'node:zlib';
import { fileURLToPath } from 'node:url';
import { performance } from 'node:perf_hooks';
import { decodeGraph } from '../site/engine/graph.js';
import { Engine } from '../site/engine/lif.js';

const root = fileURLToPath(new URL('../', import.meta.url));
const load0 = os.loadavg();
let t0 = performance.now();
const raw = zlib.gunzipSync(fs.readFileSync(root + 'site/data/graph_full.fbg.gz'));
const tGunzip = performance.now() - t0; t0 = performance.now();
const g = decodeGraph(raw.buffer.slice(raw.byteOffset, raw.byteOffset + raw.byteLength));
const tDecode = performance.now() - t0;
const meta = JSON.parse(fs.readFileSync(root + 'site/data/meta.json', 'utf8'));
const conds = { sugar_100: [['sugar', 100]], sugar_200: [['sugar', 200]], water_200: [['water', 200]], bitter_200: [['bitter', 200]], sugar_100__bitter_200: [['sugar', 100], ['bitter', 200]], sugar_100__water_100: [['sugar', 100], ['water', 100]], water_260: [['water', 260]] };
const out = { machine: { cpu: os.cpus()[0].model, cores: os.cpus().length, platform: `${os.platform()} ${os.arch()}`, node: process.version, loadavg_at_start: load0 },
  graph: { N: g.N, E: g.E, gunzip_ms: Math.round(tGunzip), decode_ms: Math.round(tDecode), typed_array_mb: (g.offsets.byteLength + g.targets.byteLength + g.counts.byteLength) / 1e6 }, runs: {} };
const REPEATS = 3;
for (const [cond, groups] of Object.entries(conds)) {
  const rtfs = []; let info = null;
  for (let rep = 0; rep < REPEATS; rep++) {
    const e = new Engine(g, { epsV: 1e-7, epsG: 1e-7, seed: 3 + rep });
    groups.forEach(([grp, hz], k) => e.setPoisson('g' + k, meta.key[grp], hz));
    for (let c = 0; c < 10; c++) e.run(1000);                       // warm-up second
    e.takeSpikes(); const spikes0 = e.totalSpikes;
    const t = performance.now(); let maxA = 0, sumA = 0, n = 0;
    for (let c = 0; c < 50; c++) { e.run(1000); maxA = Math.max(maxA, e.activeCount); sumA += e.activeCount; n++; e.takeSpikes(); }
    const wall = (performance.now() - t) / 1000;
    rtfs.push(5 / wall);
    info = { spikes_per_sim_second: Math.round((e.totalSpikes - spikes0) / 5), mean_active_set: Math.round(sumA / n), max_active_set: maxA };
  }
  rtfs.sort((a, b) => a - b);
  out.runs[cond] = { sim_seconds_per_repeat: 5, repeats: REPEATS, real_time_factor_median: +rtfs[1].toFixed(2), real_time_factor_min: +rtfs[0].toFixed(2), real_time_factor_max: +rtfs[2].toFixed(2), ...info };
  console.log(cond.padEnd(24), `${rtfs[1].toFixed(2)}x real time (min ${rtfs[0].toFixed(2)}, max ${rtfs[2].toFixed(2)})`, `spikes/s ${info.spikes_per_sim_second}`, `active ${info.mean_active_set}`);
}
out.rss_mb_after = Math.round(process.memoryUsage().rss / 1e6);
out.loadavg_at_end = os.loadavg();
fs.writeFileSync(root + 'results/engine_speed.json', JSON.stringify(out, null, 1));
console.log('wrote results/engine_speed.json; load average at start', load0.map(x => x.toFixed(1)).join(' '), 'end', out.loadavg_at_end.map(x => x.toFixed(1)).join(' '));
