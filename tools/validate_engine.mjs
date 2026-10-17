// Run the JS engine through the paper's protocol and compare with the Brian2 reference runs.
//
//   node tools/validate_engine.mjs --graph 783 --conds all --trials 30 [--eps 1e-7] [--seed0 1000]
//
// For each condition (e.g. sugar_100, sugar_100__bitter_200) the same GRN sets, rates (Poisson, per-step Bernoulli of
// rate*dt), duration (1 s) and trial count as results/reference/brian2_<graph>_<cond>.json are simulated.
// Writes results/reference/js_<graph>_<cond>.json and results/validation_js_vs_brian2_<graph>.json.
//
// Agreement criteria (stated up front, see docs/MODEL.md):
//   MN9 rate (contra and ipsi): Welch |z| <= 3.5 over 30 + 30 trials, or |difference| <= 1 Hz when both are tiny;
//   total spikes per trial: |relative difference| <= 3 %;
//   responding neurons (>= 1 spike in any trial): relative difference <= 15 % or <= 8 neurons;
//   per-neuron mean rate: Pearson r >= 0.98 over neurons with mean rate >= 0.5 Hz in either engine.
import fs from 'node:fs';
import zlib from 'node:zlib';
import { performance } from 'node:perf_hooks';
import { fileURLToPath } from 'node:url';
import { decodeGraph } from '../site/engine/graph.js';
import { Engine, PARAMS } from '../site/engine/lif.js';

const root = fileURLToPath(new URL('../', import.meta.url));
const args = Object.fromEntries(process.argv.slice(2).reduce((a, x, i, arr) => (x.startsWith('--') ? [...a, [x.slice(2), arr[i + 1]]] : a), []));
const graphVer = args.graph ?? '783';
const nTrials = +(args.trials ?? 30);
const eps = +(args.eps ?? 1e-7);
const seed0 = +(args.seed0 ?? 1000);
const tag = args.tag ?? 'js';
const T_STEPS = 10000;

function loadGraph() {
  const p = graphVer === '783' ? root + 'site/data/graph_full.fbg.gz' : root + 'tmp/graph_630.fbg.gz';
  const raw = zlib.gunzipSync(fs.readFileSync(p));
  return decodeGraph(raw.buffer.slice(raw.byteOffset, raw.byteOffset + raw.byteLength));
}
function loadIds() {
  const p = graphVer === '783' ? root + 'data/raw/shiu/Completeness_783.csv' : root + 'data/raw/shiu630/2023_03_23_completeness_630_final.csv';
  const lines = fs.readFileSync(p, 'utf8').split('\n').slice(1).filter(Boolean);
  return lines.map(l => l.split(',')[0]);                  // root ids as strings (exceed 2^53 as numbers)
}
const dirRef = root + 'results/reference/';
const refFiles = fs.readdirSync(dirRef).filter(f => f.startsWith(`brian2_${graphVer}_`) && f.endsWith('.json'));
const allConds = refFiles.map(f => f.slice(`brian2_${graphVer}_`.length, -5));
const conds = !args.conds || args.conds === 'all' ? allConds : args.conds.split(',');

const g = loadGraph();
const rootIds = loadIds();
if (rootIds.length !== g.N) throw new Error(`id list ${rootIds.length} != graph N ${g.N}`);
const idIndex = new Map(rootIds.map((r, i) => [r, i]));

// GRN sets: from the python conditions (single source of truth), exported once as JSON
const sets = JSON.parse(fs.readFileSync(root + `reference/sets_${graphVer}.json`, 'utf8'));   // {sugar:[ids], bitter:[...], water:[...], ir94e:[...], mn9_contra, mn9_ipsi}
const toIdx = (list) => list.map(r => { const i = idIndex.get(String(r)); if (i === undefined) throw new Error('missing id ' + r); return i; });
const S = { sugar: toIdx(sets.sugar), bitter: toIdx(sets.bitter), water: toIdx(sets.water), ir94e: toIdx(sets.ir94e) };
const MN9 = { contra: idIndex.get(String(sets.mn9_contra)), ipsi: idIndex.get(String(sets.mn9_ipsi)) };

function parseCond(name) {
  return name.split('__').map(part => { const m = part.match(/^([a-z0-9]+)_(\d+)$/); return { group: m[1], rate: +m[2] }; });
}
const mean = a => a.reduce((s, x) => s + x, 0) / a.length;
const sd = a => { const m = mean(a); return Math.sqrt(mean(a.map(x => (x - m) ** 2))); };
function pearson(x, y) {
  const mx = mean(x), my = mean(y); let sxy = 0, sxx = 0, syy = 0;
  for (let i = 0; i < x.length; i++) { sxy += (x[i] - mx) * (y[i] - my); sxx += (x[i] - mx) ** 2; syy += (y[i] - my) ** 2; }
  return sxy / Math.sqrt(sxx * syy);
}

const eng = new Engine(g, { epsV: eps, epsG: eps });
const summary = {};
for (const cond of conds) {
  const parts = parseCond(cond);
  const ref = JSON.parse(fs.readFileSync(dirRef + `brian2_${graphVer}_${cond}.json`, 'utf8'));
  for (const gname of ['A', 'B']) eng.setPoisson(gname, [], 0);
  parts.forEach((p, k) => eng.setPoisson('grp' + k, S[p.group], p.rate));
  for (let k = parts.length; k < 2; k++) eng.setPoisson('grp' + k, [], 0);
  const counts = [];                                       // per trial Int32Array(N) of spike counts
  const wall = [];
  const mn9Times = { contra: [], ipsi: [] };
  for (let t = 0; t < nTrials; t++) {
    eng.reset(seed0 + t);
    const t0 = performance.now();
    for (let c = 0; c < 10; c++) eng.run(T_STEPS / 10);
    wall.push(performance.now() - t0);
    const sp = eng.takeSpikes();
    const cnt = new Int32Array(g.N);
    const times = { contra: [], ipsi: [] };
    for (let k = 0; k < sp.ids.length; k++) {
      cnt[sp.ids[k]]++;
      if (sp.ids[k] === MN9.contra) times.contra.push(+(sp.steps[k] * PARAMS.dt * 1000).toFixed(1));
      else if (sp.ids[k] === MN9.ipsi) times.ipsi.push(+(sp.steps[k] * PARAMS.dt * 1000).toFixed(1));
    }
    mn9Times.contra.push(times.contra); mn9Times.ipsi.push(times.ipsi);
    counts.push(cnt);
  }
  const tRun = T_STEPS * PARAMS.dt;
  const rate = (arr) => arr.map(x => x / tRun);
  const mn9Rates = { contra: rate(counts.map(c => c[MN9.contra])), ipsi: rate(counts.map(c => c[MN9.ipsi])) };
  const totals = counts.map(c => c.reduce((s, x) => s + x, 0));
  const meanRate = new Float64Array(g.N);
  for (const c of counts) for (let i = 0; i < g.N; i++) meanRate[i] += c[i] / nTrials / tRun;
  const responding = [];
  for (let i = 0; i < g.N; i++) if (meanRate[i] > 0) responding.push(i);
  // reference per-neuron mean rates
  const refRate = new Float64Array(g.N);
  for (const [rid, arr] of Object.entries(ref.per_neuron_counts)) refRate[idIndex.get(rid)] = mean(arr) / (ref.t_run_ms / 1000);
  const both = [];
  for (let i = 0; i < g.N; i++) if (meanRate[i] >= 0.5 || refRate[i] >= 0.5) both.push(i);
  const r = pearson(both.map(i => meanRate[i]), both.map(i => refRate[i]));

  // supplementary, noise-aware metric: per-neuron total counts over the trials, z = (C_js - C_b2)/sqrt(C_js + C_b2)
  // (Poisson counting noise; spike counts are sub-Poisson, so this is conservative). Equivalent engines give mean z^2 ~ 1 or less.
  let zz = 0, nz = 0, big = 0;
  const refTot = new Float64Array(g.N);
  for (const [rid, arr] of Object.entries(ref.per_neuron_counts)) refTot[idIndex.get(rid)] = arr.reduce((a, b) => a + b, 0);
  for (let i = 0; i < g.N; i++) {
    let c1 = 0; for (const c of counts) c1 += c[i];
    const c2 = refTot[i];
    if (c1 + c2 < 3) continue;
    const z = (c1 - c2) / Math.sqrt(c1 + c2); zz += z * z; nz++; if (Math.abs(z) > 3) big++;
  }
  const welch = (a, b) => { const sa = sd(a) ** 2 / a.length, sb = sd(b) ** 2 / b.length; return (mean(a) - mean(b)) / Math.sqrt(sa + sb + 1e-12); };
  const res = {};
  for (const w of ['contra', 'ipsi']) {
    const bm = ref.mn9_rate_hz[w], z = welch(mn9Rates[w], bm.per_trial);
    const diff = mean(mn9Rates[w]) - bm.mean;
    res['mn9_' + w] = { js_mean: mean(mn9Rates[w]), js_sd: sd(mn9Rates[w]), brian2_mean: bm.mean, brian2_sd: bm.std, diff, z,
                        js_trials_with_spikes: mn9Rates[w].filter(x => x > 0).length, brian2_trials_with_spikes: bm.trials_with_spikes,
                        pass: Math.abs(z) <= 3.5 || Math.abs(diff) <= 1.0 };
  }
  const refTotal = mean(ref.total_spikes_per_trial), jsTotal = mean(totals);
  res.total_spikes = { js: jsTotal, brian2: refTotal, rel_diff: (jsTotal - refTotal) / Math.max(refTotal, 1), pass: Math.abs(jsTotal - refTotal) <= 0.03 * Math.max(refTotal, 1) };
  res.responding = { js: responding.length, brian2: ref.n_responding_neurons_any_trial,
                     pass: Math.abs(responding.length - ref.n_responding_neurons_any_trial) <= Math.max(8, 0.15 * ref.n_responding_neurons_any_trial) };
  res.rate_correlation = { pearson_r: r, n_neurons: both.length, pass: r >= 0.98 };
  res.count_z = { mean_z2: zz / Math.max(nz, 1), n_neurons: nz, n_abs_z_gt_3: big };
  res.speed = { ms_per_trial_mean: mean(wall), real_time_factor: 1000 / mean(wall) };
  res.pass = res.mn9_contra.pass && res.mn9_ipsi.pass && res.total_spikes.pass && res.responding.pass && res.rate_correlation.pass;
  summary[cond] = res;

  const perNeuron = {};
  for (const i of responding) perNeuron[rootIds[i]] = counts.map(c => c[i]);
  fs.writeFileSync(dirRef + `${tag}_${graphVer}_${cond}.json`, JSON.stringify({
    engine: 'js', graph: graphVer, condition: cond, n_trials: nTrials, t_run_ms: tRun * 1000, seed0, eps_volts: eps,
    mn9_rate_hz: { contra: { mean: mean(mn9Rates.contra), std: sd(mn9Rates.contra), per_trial: mn9Rates.contra, trials_with_spikes: mn9Rates.contra.filter(x => x > 0).length },
                   ipsi: { mean: mean(mn9Rates.ipsi), std: sd(mn9Rates.ipsi), per_trial: mn9Rates.ipsi, trials_with_spikes: mn9Rates.ipsi.filter(x => x > 0).length } },
    mn9_spike_times_ms: mn9Times, n_responding_neurons_any_trial: responding.length, total_spikes_per_trial: totals,
    per_neuron_counts: perNeuron, wall_ms_per_trial: wall,
  }));
  const f = (x, d = 1) => x.toFixed(d);
  console.log(`${cond.padEnd(24)} MN9 contra js ${f(res.mn9_contra.js_mean)} vs b2 ${f(res.mn9_contra.brian2_mean)} (z ${f(res.mn9_contra.z, 2)}) | ipsi ${f(res.mn9_ipsi.js_mean)} vs ${f(res.mn9_ipsi.brian2_mean)} (z ${f(res.mn9_ipsi.z, 2)}) | spikes ${f(jsTotal, 0)} vs ${f(refTotal, 0)} | resp ${responding.length} vs ${ref.n_responding_neurons_any_trial} | r=${f(r, 4)} z2=${f(res.count_z.mean_z2, 2)} | ${f(res.speed.real_time_factor, 2)}x RT | ${res.pass ? 'PASS' : 'FAIL'}`);
}
fs.writeFileSync(root + `results/validation_${tag}_vs_brian2_${graphVer}.json`, JSON.stringify({
  engine: 'js', eps_volts: eps, n_trials: nTrials, seed0, criteria: {
    mn9: 'Welch |z| <= 3.5 or |diff| <= 1 Hz', total_spikes: '|rel diff| <= 3%', responding: '<= 15% or 8 neurons', rate_correlation: 'Pearson r >= 0.98 for neurons >= 0.5 Hz' },
  conditions: summary, all_pass: Object.values(summary).every(r => r.pass) }, null, 1));
console.log('ALL PASS:', Object.values(summary).every(r => r.pass));
