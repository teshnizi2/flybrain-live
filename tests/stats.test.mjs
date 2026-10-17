// Statistical validation of the JS engine against the Brian2 reference runs (results/reference/brian2_783_*.json,
// the authors' unmodified model.py, 30 trials of 1 s per condition).
//
// Protocol: the JS engine runs 30 independent 1 s trials per condition with the same GRN sets and Poisson rates.
// Criterion (fixed in advance): for the MN9 contralateral and ipsilateral rates, Welch |z| <= 3.5 over the 30 + 30
// trial rates, or |difference| <= 1 Hz when both are tiny; total spikes per trial within 3 %.
// Negative control: the same test must reject a stimulus that is 20 % too weak (sugar at 80 Hz instead of 100 Hz).
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import zlib from 'node:zlib';
import { decodeGraph } from '../site/engine/graph.js';
import { Engine } from '../site/engine/lif.js';

const dir = new URL('../results/reference/', import.meta.url);
const meta = JSON.parse(fs.readFileSync(new URL('../site/data/meta.json', import.meta.url), 'utf8'));
const raw = zlib.gunzipSync(fs.readFileSync(new URL('../site/data/graph_full.fbg.gz', import.meta.url)));
const graph = decodeGraph(raw.buffer.slice(raw.byteOffset, raw.byteOffset + raw.byteLength));
const mean = a => a.reduce((s, x) => s + x, 0) / a.length;
const sd = a => { const m = mean(a); return Math.sqrt(mean(a.map(x => (x - m) ** 2))); };
const welchZ = (a, b) => (mean(a) - mean(b)) / Math.sqrt(sd(a) ** 2 / a.length + sd(b) ** 2 / b.length + 1e-12);

function runJs(groups, seed0, trials = 30) {
  const eng = new Engine(graph, { epsV: 1e-7, epsG: 1e-7 });
  groups.forEach(([g, hz], k) => eng.setPoisson('g' + k, meta.key[g], hz));
  const contra = [], ipsi = [], totals = [];
  for (let t = 0; t < trials; t++) {
    eng.reset(seed0 + t); eng.run(10000);
    const s = eng.takeSpikes(); let c = 0, i = 0;
    for (const id of s.ids) { if (id === meta.key.mn9_contra) c++; else if (id === meta.key.mn9_ipsi) i++; }
    contra.push(c); ipsi.push(i); totals.push(s.ids.length);
  }
  return { contra, ipsi, totals };
}
const parse = (name) => name.split('__').map(p => { const m = p.match(/^([a-z0-9]+)_(\d+)$/); return [m[1], +m[2]]; });

for (const cond of ['sugar_100', 'water_200', 'bitter_200', 'sugar_100__bitter_200']) {
  test(`gustatory condition ${cond}: JS MN9 rates and total spikes agree with Brian2 (30 trials each)`, { timeout: 900000 }, () => {
    const ref = JSON.parse(fs.readFileSync(new URL(`brian2_783_${cond}.json`, dir), 'utf8'));
    const js = runJs(parse(cond), 9000);
    for (const who of ['contra', 'ipsi']) {
      const refRates = ref.mn9_rate_hz[who].per_trial, jsRates = js[who];
      const diff = mean(jsRates) - mean(refRates), z = welchZ(jsRates, refRates);
      assert.ok(Math.abs(z) <= 3.5 || Math.abs(diff) <= 1, `${cond} MN9 ${who}: js ${mean(jsRates).toFixed(1)} Hz vs brian2 ${mean(refRates).toFixed(1)} Hz (z = ${z.toFixed(2)})`);
    }
    const refTotal = mean(ref.total_spikes_per_trial), jsTotal = mean(js.totals);
    assert.ok(Math.abs(jsTotal - refTotal) <= 0.03 * refTotal, `${cond} total spikes: js ${jsTotal.toFixed(0)} vs brian2 ${refTotal.toFixed(0)}`);
    if (cond === 'sugar_100') assert.equal(js.contra.filter(x => x > 0).length, 30, 'MN9 fires in every trial at 100 Hz sugar (the paper: 100 % of simulations)');
    if (cond === 'bitter_200' || cond === 'sugar_100__bitter_200') assert.ok(mean(js.contra) < 1, 'bitter leaves MN9 silent');
  });
}

test('negative control: sugar at 80 Hz is rejected against the 100 Hz reference (the criterion has power)', { timeout: 900000 }, () => {
  const ref = JSON.parse(fs.readFileSync(new URL('brian2_783_sugar_100.json', dir), 'utf8'));
  const js = runJs([['sugar', 80]], 9500);
  const z = welchZ(js.contra, ref.mn9_rate_hz.contra.per_trial);
  assert.ok(Math.abs(z) > 3.5 && Math.abs(mean(js.contra) - ref.mn9_rate_hz.contra.mean) > 1, `a 20 % weaker stimulus should be detected, z = ${z.toFixed(1)}`);
});
