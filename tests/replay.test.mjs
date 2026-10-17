// Full-network deterministic replay: 138,639 neurons, 15.09 M connections, explicit input events.
// results/reference/replay_783_<cond>.json were produced by reference/replay_brian2.py (Brian2, the authors'
// unmodified model.py, events injected in the PoissonInput slot, 10,000 steps = 1 s). The JS engine must reproduce
// every spike (step and neuron), with exact arithmetic (eps = 0) and with the production snapping (eps = 1e-7 V).
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import zlib from 'node:zlib';
import { decodeGraph } from '../site/engine/graph.js';
import { Engine } from '../site/engine/lif.js';

const graphPath = new URL('../site/data/graph_full.fbg.gz', import.meta.url);
const conds = ['sugar_100', 'sugar_200', 'water_200', 'sugar_100__bitter_200'];
let graph = null;
function getGraph() {
  if (!graph) { const raw = zlib.gunzipSync(fs.readFileSync(graphPath)); graph = decodeGraph(raw.buffer.slice(raw.byteOffset, raw.byteOffset + raw.byteLength)); }
  return graph;
}
function run(cond, eps) {
  const ref = JSON.parse(fs.readFileSync(new URL(`../results/reference/replay_783_${cond}.json`, import.meta.url), 'utf8'));
  const eng = new Engine(getGraph(), { epsV: eps, epsG: eps });
  eng.setNoRefractory([...new Set(ref.events.map(e => e[1]))]);
  eng.setEventSchedule(Int32Array.from(ref.events.map(e => e[0])), Int32Array.from(ref.events.map(e => e[1])));
  eng.run(ref.steps);
  const s = eng.takeSpikes();
  return { ref, spikes: Array.from(s.steps, (st, k) => [st, s.ids[k]]) };
}
function check({ ref, spikes }) {
  assert.ok(ref.spikes.length > 2000, 'reference should contain a real cascade');
  const n = Math.min(spikes.length, ref.spikes.length);
  for (let k = 0; k < n; k++) if (spikes[k][0] !== ref.spikes[k][0] || spikes[k][1] !== ref.spikes[k][1]) assert.fail(`first difference at spike #${k}: js ${spikes[k]} brian2 ${ref.spikes[k]}`);
  assert.equal(spikes.length, ref.spikes.length, 'spike count');
}
for (const cond of conds) {
  const have = fs.existsSync(new URL(`../results/reference/replay_783_${cond}.json`, import.meta.url)) && fs.existsSync(graphPath);
  test(`full network ${cond}, exact arithmetic (no snapping): every spike identical to Brian2`, { skip: !have, timeout: 600000 }, () => check(run(cond, 0)));
  test(`full network ${cond}, production snapping (eps = 1e-7 V): every spike identical to Brian2`, { skip: !have, timeout: 600000 }, () => check(run(cond, 1e-7)));
}
