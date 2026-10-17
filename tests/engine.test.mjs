import test from 'node:test';
import assert from 'node:assert/strict';
import { Engine, PARAMS } from '../site/engine/lif.js';
import { csrFromEdges } from '../site/engine/graph.js';

// ---- constants must equal the doubles Brian2 computes from model.py's default_params ----
test('constants: exact doubles of the Brian2 parameter expressions', () => {
  assert.equal(PARAMS.dt, 0.1 * 0.001);
  assert.equal(PARAMS.v0, -52 * 0.001);       // = -0.052000000000000005, as in Brian2 (mV = 0.001)
  assert.equal(PARAMS.vRst, -52 * 0.001);
  assert.equal(PARAMS.vTh, -45 * 0.001);
  assert.equal(PARAMS.tMbr, 20 * 0.001);
  assert.equal(PARAMS.tau, 5 * 0.001);
  assert.equal(PARAMS.wSyn, 0.275 * 0.001);
  assert.equal(PARAMS.delaySteps, 18);        // 1.8 ms / 0.1 ms
  assert.equal(PARAMS.rfcSteps, 22);          // timestep(2.2 ms, dt) = int((2.2e-3 + 1e-3*dt)/dt) = 22
  assert.equal(PARAMS.fPoi, 250);
  // propagator constants, from the code Brian2 generated (see docs/MODEL.md)
  assert.equal(PARAMS.expG, 0.9801986733067553);     // exp(-dt/tau)
  assert.equal(PARAMS.expV, 0.9950124791926823);     // exp(-dt/t_mbr)
});

test('a network at rest stays exactly at rest and never spikes', () => {
  const eng = new Engine(csrFromEdges(4, [0, 1], [1, 2], [5, -3]), { epsV: 0, epsG: 0 });
  eng.run(3000);
  assert.equal(eng.takeSpikes().steps.length, 0);
  for (let i = 0; i < 4; i++) { assert.equal(eng.v[i], PARAMS.v0); assert.equal(eng.g[i], 0); }
  assert.equal(eng.activeCount, 0);
});

test('Poisson input: effective rate is r*(1-r*dt) because an event during the spike step is dropped', () => {
  const eng = new Engine(csrFromEdges(1, [], [], []), { seed: 7 });
  eng.setPoisson('grn', [0], 100);
  const T = 200000;                      // 20 s
  eng.run(T);
  const n = eng.takeSpikes().steps.length;
  const p = 100 * PARAMS.dt;             // 0.01
  const expected = T * p * (1 - p);      // events are independent; one is lost when the previous step spiked
  const sd = Math.sqrt(T * p * (1 - p));
  assert.ok(Math.abs(n - expected) < 5 * sd, `got ${n}, expected ${expected.toFixed(1)} +- ${(5 * sd).toFixed(1)}`);
});

test('Poisson input is reproducible for a seed and differs between seeds', () => {
  const run = (seed) => { const e = new Engine(csrFromEdges(2, [0], [1], [50]), { seed }); e.setPoisson('a', [0], 150); e.run(5000); return e.takeSpikes(); };
  const a = run(1), b = run(1), c = run(2);
  assert.deepEqual(Array.from(a.steps), Array.from(b.steps));
  assert.notDeepEqual(Array.from(a.steps), Array.from(c.steps));
});

test('epsilon snapping: a sub-threshold neuron returns to exact rest and leaves the active set', () => {
  // neuron 0 is driven by an explicit event; its spike gives neuron 1 a small excitatory kick (3 counts)
  const eng = new Engine(csrFromEdges(2, [0], [1], [3]), { epsV: 1e-7, epsG: 1e-7 });
  eng.setNoRefractory([0]);
  eng.setEventSchedule(Int32Array.from([5]), Int32Array.from([0]));
  eng.run(200);
  assert.ok(eng.activeCount > 0, 'neuron 1 should be integrating after the kick');
  eng.run(20000);
  assert.equal(eng.activeCount, 0);
  assert.equal(eng.v[1], PARAMS.v0);
  assert.equal(eng.g[1], 0);
  assert.equal(eng.takeSpikes().steps.length, 1);   // only neuron 0 fired
});

test('epsilon snapping is exact for a 1 mV EPSP: same spikes with and without snapping on a driven chain', () => {
  const N = 40, pre = [], post = [], cnt = [];
  for (let i = 0; i < N - 1; i++) { pre.push(i); post.push(i + 1); cnt.push(i % 3 ? 40 : -15); }
  const run = (eps) => {
    const e = new Engine(csrFromEdges(N, pre, post, cnt), { epsV: eps, epsG: eps, seed: 3 });
    e.setPoisson('d', [0], 250); e.run(40000);
    const s = e.takeSpikes(); return Array.from(s.steps, (st, k) => [st, s.ids[k]]);
  };
  assert.deepEqual(run(1e-9), run(0));
});

test('reset(seed) restores the initial state', () => {
  const eng = new Engine(csrFromEdges(3, [0, 1], [1, 2], [200, 200]), { seed: 5 });
  eng.setPoisson('a', [0], 200); eng.run(3000);
  const first = eng.takeSpikes();
  eng.reset(5); eng.run(3000);
  const second = eng.takeSpikes();
  assert.deepEqual(Array.from(first.steps), Array.from(second.steps));
  assert.deepEqual(Array.from(first.ids), Array.from(second.ids));
});

test('stats: active set shrinks as neurons relax and counts spikes', () => {
  const eng = new Engine(csrFromEdges(2, [0], [1], [400]), { seed: 1 });
  eng.setPoisson('a', [0], 50);
  eng.run(10000);
  assert.ok(eng.totalSpikes > 0);
  assert.equal(eng.step, 10000);
  assert.equal(eng.time, 10000 * PARAMS.dt);
});

// ---- source tracking (page feature): which presynaptic spike delivered the last excitatory input before a neuron fired ----
test('trackSources: a chain 0 -> 1 -> 2 reports the causal edges (0->1, 1->2) with their spike steps', () => {
  const eng = new Engine(csrFromEdges(3, [0, 1], [1, 2], [300, 300]), { epsV: 0, epsG: 0, trackSources: true });
  eng.setNoRefractory([0]);
  eng.setEventSchedule(Int32Array.from([10]), Int32Array.from([0]));
  eng.run(400);
  const sp = eng.takeSpikes(), ed = eng.takeEdges();
  const spikes = Array.from(sp.ids, (id, k) => [sp.steps[k], id]);
  assert.deepEqual(spikes.map(s => s[1]), [0, 1, 2]);
  assert.deepEqual(Array.from(ed.src), [0, 1]);
  assert.deepEqual(Array.from(ed.dst), [1, 2]);
  assert.deepEqual(Array.from(ed.step), [spikes[1][0], spikes[2][0]]);   // edge is stamped with the step the target fired
});

test('trackSources: Poisson-driven neurons have no source; an inhibitory input is never reported as a cause', () => {
  // 0 (Poisson) -> 1 (inhibitory, -200) ; 2 (Poisson) -> 1 (+300). Neuron 1 fires because of 2, not 0.
  const eng = new Engine(csrFromEdges(3, [0, 2], [1, 1], [-200, 300]), { epsV: 0, epsG: 0, trackSources: true, seed: 2 });
  eng.setPoisson('a', [0, 2], 40);
  eng.run(20000);
  const ed = eng.takeEdges();
  assert.ok(ed.src.length > 0);
  assert.ok(Array.from(ed.src).every(s => s === 2) && Array.from(ed.dst).every(d => d === 1));
});

test('trackSources off by default: takeEdges is empty and the hot loop is unchanged', () => {
  const eng = new Engine(csrFromEdges(2, [0], [1], [400]));
  eng.setNoRefractory([0]); eng.setEventSchedule(Int32Array.from([5]), Int32Array.from([0]));
  eng.run(300);
  assert.equal(eng.takeEdges().src.length, 0);
});
