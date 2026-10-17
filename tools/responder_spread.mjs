// How variable is "number of neurons that fired at least once in 30 trials" (the paper's 'responding neurons' count)?
// 6 independent blocks of 30 one-second trials per condition with the JS engine; writes results/responder_spread.json.
import fs from 'node:fs';
import zlib from 'node:zlib';
import { fileURLToPath } from 'node:url';
import { decodeGraph } from '../site/engine/graph.js';
import { Engine } from '../site/engine/lif.js';
const root = fileURLToPath(new URL('../', import.meta.url));
const raw = zlib.gunzipSync(fs.readFileSync(root + 'site/data/graph_full.fbg.gz'));
const g = decodeGraph(raw.buffer.slice(raw.byteOffset, raw.byteOffset + raw.byteLength));
const meta = JSON.parse(fs.readFileSync(root + 'site/data/meta.json', 'utf8'));
const conds = { sugar_100: [['sugar', 100]], water_200: [['water', 200]] };
const out = {};
for (const [cond, groups] of Object.entries(conds)) {
  const counts = [];
  for (let block = 0; block < 6; block++) {
    const fired = new Uint8Array(g.N); const e = new Engine(g, { epsV: 1e-7, epsG: 1e-7 });
    groups.forEach(([grp, hz], k) => e.setPoisson('g' + k, meta.key[grp], hz));
    for (let t = 0; t < 30; t++) { e.reset(20000 + block * 100 + t); e.run(10000); const s = e.takeSpikes(); for (const id of s.ids) fired[id] = 1; }
    counts.push(fired.reduce((a, b) => a + b, 0));
  }
  const m = counts.reduce((a, b) => a + b, 0) / counts.length, sd = Math.sqrt(counts.reduce((a, b) => a + (b - m) ** 2, 0) / (counts.length - 1));
  out[cond] = { blocks_of_30_trials: counts, mean: m, sd };
  console.log(cond, counts.join(' '), 'mean', m.toFixed(1), 'sd', sd.toFixed(1));
}
fs.writeFileSync(root + 'results/responder_spread.json', JSON.stringify(out, null, 1));
