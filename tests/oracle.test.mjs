// Oracle tests: the JS engine must reproduce the authors' Brian2 model exactly on small random networks.
// Fixtures come from tests/fixtures/make_fixtures.py (Brian2, unmodified model.py, cython target).
// Same input events in both implementations -> spike trains must be identical and the (v, g) traces equal
// to the last bit (same operations in the same order, float64).
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { Engine } from '../site/engine/lif.js';
import { csrFromEdges } from '../site/engine/graph.js';

const dir = new URL('./fixtures/', import.meta.url);
const names = ['micro_chain', 'small_a', 'small_b', 'small_c'];

function runFixture(fx) {
  const csr = csrFromEdges(fx.N, fx.pre, fx.post, fx.cnt);
  const eng = new Engine(csr, { epsV: 0, epsG: 0 });
  eng.setNoRefractory(fx.rfc_zero);
  eng.setEventSchedule(Int32Array.from(fx.events.map(e => e[0])), Int32Array.from(fx.events.map(e => e[1])));
  const trace = {};
  for (const i of fx.trace_ids) trace[i] = { v: [], g: [] };
  for (let n = 0; n < fx.n_steps; n++) {
    for (const i of fx.trace_ids) { trace[i].v.push(eng.v[i]); trace[i].g.push(eng.g[i]); }
    eng.run(1);
  }
  const s = eng.takeSpikes();
  const spikes = Array.from(s.steps, (st, k) => [st, s.ids[k]]);
  return { spikes, trace };
}

for (const name of names) {
  const fx = JSON.parse(fs.readFileSync(new URL(`${name}.json`, dir), 'utf8'));
  test(`oracle ${name}: spike trains identical to Brian2 (${fx.spikes.length} spikes)`, () => {
    const { spikes } = runFixture(fx);
    assert.equal(spikes.length, fx.spikes.length, 'spike count');
    assert.deepEqual(spikes, fx.spikes);
  });
  test(`oracle ${name}: v and g traces bit-identical to Brian2`, () => {
    const { trace } = runFixture(fx);
    for (const i of fx.trace_ids) {
      const ref = fx.trace[String(i)];
      for (let n = 0; n < fx.n_steps; n++) {
        if (trace[i].v[n] !== ref.v[n] || trace[i].g[n] !== ref.g[n]) {
          assert.fail(`neuron ${i} step ${n}: js v=${trace[i].v[n]} g=${trace[i].g[n]}  brian2 v=${ref.v[n]} g=${ref.g[n]}`);
        }
      }
    }
  });
}
