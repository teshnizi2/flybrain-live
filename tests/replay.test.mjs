// Full-network deterministic replay: 138,639 neurons, 15.09 M connections, explicit input events.
// results/reference/replay_783_sugar_100.json was produced by reference/replay_brian2.py (Brian2, the authors'
// unmodified model.py, events injected in the PoissonInput slot). The JS engine must reproduce every spike.
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import zlib from 'node:zlib';
import { decodeGraph } from '../site/engine/graph.js';
import { Engine } from '../site/engine/lif.js';

const refPath = new URL('../results/reference/replay_783_sugar_100.json', import.meta.url);
const graphPath = new URL('../site/data/graph_full.fbg.gz', import.meta.url);
const skip = !fs.existsSync(refPath) || !fs.existsSync(graphPath);

function run(eps) {
  const ref = JSON.parse(fs.readFileSync(refPath, 'utf8'));
  const raw = zlib.gunzipSync(fs.readFileSync(graphPath));
  const g = decodeGraph(raw.buffer.slice(raw.byteOffset, raw.byteOffset + raw.byteLength));
  const eng = new Engine(g, { epsV: eps, epsG: eps });
  eng.setNoRefractory([...new Set(ref.events.map(e => e[1]))]);
  eng.setEventSchedule(Int32Array.from(ref.events.map(e => e[0])), Int32Array.from(ref.events.map(e => e[1])));
  eng.run(ref.steps);
  const s = eng.takeSpikes();
  const spikes = Array.from(s.steps, (st, k) => [st, s.ids[k]]);
  return { ref, spikes };
}
function firstDiff(a, b) {
  const n = Math.min(a.length, b.length);
  for (let k = 0; k < n; k++) if (a[k][0] !== b[k][0] || a[k][1] !== b[k][1]) return `first difference at spike #${k}: js ${a[k]} brian2 ${b[k]}`;
  return `lengths differ: js ${a.length} brian2 ${b.length}`;
}

test('full network, exact arithmetic (no snapping): spike trains identical to Brian2 over 1 s', { skip, timeout: 600000 }, () => {
  const { ref, spikes } = run(0);
  assert.ok(ref.spikes.length > 5000, 'reference should contain a real cascade');
  if (spikes.length !== ref.spikes.length || spikes.some((s, k) => s[0] !== ref.spikes[k][0] || s[1] !== ref.spikes[k][1])) assert.fail(firstDiff(spikes, ref.spikes));
});

test('full network, production snapping (eps = 1e-7 V): spike trains identical to Brian2 over 1 s', { skip, timeout: 600000 }, () => {
  const { ref, spikes } = run(1e-7);
  if (spikes.length !== ref.spikes.length || spikes.some((s, k) => s[0] !== ref.spikes[k][0] || s[1] !== ref.spikes[k][1])) assert.fail(firstDiff(spikes, ref.spikes));
});
