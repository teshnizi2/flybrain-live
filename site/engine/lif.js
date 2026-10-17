// Leaky integrate-and-fire engine for the whole Drosophila brain, a line-by-line mirror of the Brian2 model in
// Shiu et al. 2024 (philshiu/Drosophila_brain_model, model.py) as Brian2 executes it. See docs/MODEL.md.
//
// Equations (per neuron, SI units, dt = 0.1 ms):
//   dv/dt = (v_0 - v + g) / t_mbr,   dg/dt = -g / tau        (both frozen while refractory)
//   spike when v > v_th and not refractory;  reset v = v_rst, g = 0
//   a spike at step n adds count * w_syn to g of every target at step n + 18 (1.8 ms) unless the target is refractory
//   Poisson input adds f_poi * w_syn = 68.75 mV to v of the stimulated neuron (which has refractory period 0)
// The linear subthreshold system is integrated exactly over a step (Brian2's 'linear' method); we use the very
// same expression and operation order as the C code Brian2 generates, so results match to the last bit.
//
// One time step, in Brian2's schedule order:  groups (state update) -> thresholds -> synapses (delayed spikes,
// then Poisson/events) -> resets.  A neuron that spiked in this step is "not refractory = false" for the rest of the
// step (so input arriving in the same step is dropped), and stays so for timestep(t_rfc) steps.
//
// Speed: only neurons whose state differs from rest are integrated (the active set). Resting neurons are an exact
// fixed point of the update (v_0 - v_0*e + e*v_0 == v_0 in float64), so skipping them is exact. Optional snapping of
// |v - v_0| <= epsV and |g| <= epsG to exact rest removes relaxing neurons from the set (approximation, tested).
import { Sfc32 } from './prng.js';

const SRC_LAG_STEPS = 150;               // an input counts as the cause of a spike if it arrived <= 15 ms earlier
const MV = 0.001;                         // Brian2: 1 mV = 0.001 V (a double)
const timestep = (t, dt) => Math.trunc((t + 1e-3 * dt) / dt);   // Brian2's _timestep

function derive(p) {
  const { dt, tau, tMbr, v0 } = p;
  const l1 = (-dt) / tau, l3 = tau / (tMbr - tau), l4 = dt / tMbr, l5 = dt / tau, l6 = (-dt) / tMbr;
  const expG = Math.exp(l1);                                            // _lio_2
  const A0 = v0 - (v0 * Math.exp(l6));                                  // _lio_8
  const C9 = ((l3 * ((-Math.exp(l4)) + Math.exp(l5))) * Math.exp(l6)) * Math.exp(l1);   // _lio_9
  const expV = Math.exp(l6);                                            // _lio_10
  return { expG, A0, C9, expV };
}

/** Parameters of model.py default_params, as the doubles Brian2 computes from them. */
export const PARAMS = (() => {
  const p = {
    dt: 0.1 * MV,                 // Brian2 default clock
    v0: -52 * MV, vRst: -52 * MV, vTh: -45 * MV,
    tMbr: 20 * MV, tau: 5 * MV, tRfc: 2.2 * MV, tDly: 1.8 * MV,
    wSyn: 0.275 * MV, fPoi: 250,
  };
  p.delaySteps = Math.round(p.tDly / p.dt);        // 18
  p.rfcSteps = timestep(p.tRfc, p.dt);             // 22
  p.wPoi = 68.75 * MV;                             // = w_syn * f_poi as Brian2 writes it into the generated code
  Object.assign(p, derive(p));
  return Object.freeze(p);
})();

export class Engine {
  /**
   * @param csr   {N, offsets, targets, counts} (see graph.js)
   * @param opts  {seed, epsV, epsG, trackSources}  epsV/epsG in volts; 0 = no snapping (exactly Brian2).
   *              trackSources: remember, per neuron, the presynaptic spike that last delivered excitatory input, and
   *              report (source, target, step) when the target fires (used by the page to draw cascade lines).
   */
  constructor(csr, opts = {}) {
    this.N = csr.N; this.offsets = csr.offsets; this.targets = csr.targets; this.counts = csr.counts;
    this.epsV = opts.epsV ?? 1e-7; this.epsG = opts.epsG ?? 1e-7;
    const N = this.N, P = PARAMS;
    this.v = new Float64Array(N).fill(P.v0);
    this.g = new Float64Array(N);
    this.lastSpike = new Int32Array(N).fill(-1000000000);
    this.refSteps = new Uint8Array(N).fill(P.rfcSteps);     // timestep(rfc), at least 1 (see run())
    this.inActive = new Uint8Array(N);
    this.active = new Int32Array(N);
    this.nActive = 0;
    this.spkTmp = new Int32Array(N);
    this.R = P.delaySteps + 1;
    this.ringIds = Array.from({ length: this.R }, () => new Int32Array(256));
    this.ringN = new Int32Array(this.R);
    this.rng = new Sfc32(opts.seed ?? 1);
    this.groups = new Map();            // name -> {ids: Int32Array, thr: number}
    this.evSteps = new Int32Array(0); this.evIds = new Int32Array(0); this.evPos = 0;
    this.outSteps = new Int32Array(4096); this.outIds = new Int32Array(4096); this.nOut = 0;
    this.step = 0; this.totalSpikes = 0;
    this.trackSources = !!opts.trackSources;
    if (this.trackSources) {
      this.srcId = new Int32Array(N).fill(-1); this.srcStep = new Int32Array(N).fill(-1000000000);
      this.edgeSrc = new Int32Array(1024); this.edgeDst = new Int32Array(1024); this.edgeStep = new Int32Array(1024); this.nEdge = 0;
    }
  }

  get time() { return this.step * PARAMS.dt; }
  get activeCount() { return this.nActive; }

  /** Back to the initial state (rest, empty delay line, step 0) with a fresh PRNG stream; stimulus groups are kept. */
  reset(seed) {
    this.v.fill(PARAMS.v0); this.g.fill(0); this.lastSpike.fill(-1000000000);
    this.inActive.fill(0); this.nActive = 0; this.ringN.fill(0);
    this.evPos = 0; this.nOut = 0; this.step = 0; this.totalSpikes = 0;
    if (this.trackSources) { this.srcId.fill(-1); this.srcStep.fill(-1000000000); this.nEdge = 0; }
    if (seed !== undefined) this.rng.seed(seed);
  }

  /** Neurons whose refractory period is 0 (model.py poi() sets rfc = 0 for Poisson targets). */
  setNoRefractory(ids) { for (const i of ids) this.refSteps[i] = 1; }

  /** Independent Poisson input of `rateHz` to each neuron in `ids` (group `name`); rate <= 0 removes the group. */
  setPoisson(name, ids, rateHz) {
    const old = this.groups.get(name);
    if (old) for (const i of old.ids) this.refSteps[i] = PARAMS.rfcSteps;
    if (!(rateHz > 0)) { this.groups.delete(name); this._refreshNoRefractory(); return; }
    this.groups.set(name, { ids: Int32Array.from(ids), thr: Sfc32.threshold(rateHz * PARAMS.dt) });
    this._refreshNoRefractory();
  }
  _refreshNoRefractory() { for (const grp of this.groups.values()) for (const i of grp.ids) this.refSteps[i] = 1; }

  /** Replay mode: explicit input events (step ascending). Applied exactly like a Poisson event. */
  setEventSchedule(steps, ids) { this.evSteps = steps; this.evIds = ids; this.evPos = 0; }

  _grow(arr) { const b = new Int32Array(arr.length * 2); b.set(arr); return b; }

  /** Advance `nSteps` time steps. Spikes are appended to the output buffer; read them with takeSpikes(). */
  run(nSteps) {
    const P = PARAMS, N = this.N;
    const { v, g, lastSpike, refSteps, inActive, active, spkTmp, ringN, R } = this;
    const { offsets, targets, counts } = this;
    const { expG, A0, C9, expV, vTh, v0, vRst, wSyn, wPoi, delaySteps: D } = P;
    const epsV = this.epsV, epsG = this.epsG;
    const trackSrc = this.trackSources, srcId = this.srcId, srcStep = this.srcStep;
    let nActive = this.nActive;
    for (let s = 0; s < nSteps; s++) {
      const n = this.step;
      // ---- groups + thresholds: exact update of every active (hence non-refractory) neuron; spike test
      let nSpk = 0, w = 0;
      for (let a = 0; a < nActive; a++) {
        const i = active[a];
        const gi = g[i];
        const vNew = A0 + ((C9 * gi) + (expV * v[i]));
        const gNew = expG * gi;
        if (vNew > vTh) {                       // spike: leaves the active set; reset happens at the end of the step
          v[i] = vNew; g[i] = gNew; spkTmp[nSpk++] = i; inActive[i] = 0; lastSpike[i] = n;
          continue;
        }
        const dv = vNew - v0, ag = gNew < 0 ? -gNew : gNew;
        if ((dv < 0 ? -dv : dv) <= epsV && ag <= epsG) {   // at (or snapped to) rest: exact fixed point, stop integrating
          v[i] = v0; g[i] = 0; inActive[i] = 0; continue;
        }
        v[i] = vNew; g[i] = gNew; active[w++] = i;
      }
      nActive = w;
      if (nSpk > 1) spkTmp.subarray(0, nSpk).sort();         // Brian2 emits spikes in ascending neuron order

      // ---- synapses, part 1: spikes emitted D steps ago arrive now (dropped at refractory targets)
      const slot = n % R, nDue = ringN[slot];
      if (nDue) {
        const due = this.ringIds[slot];
        if (!trackSrc) {
          for (let q = 0; q < nDue; q++) {
            const j = due[q], kEnd = offsets[j + 1];
            for (let k = offsets[j]; k < kEnd; k++) {
              const t = targets[k];
              if (n - lastSpike[t] >= refSteps[t]) {
                g[t] += counts[k] * wSyn;
                if (inActive[t] === 0) { inActive[t] = 1; active[nActive++] = t; }
              }
            }
          }
        } else {
          for (let q = 0; q < nDue; q++) {
            const j = due[q], kEnd = offsets[j + 1];
            for (let k = offsets[j]; k < kEnd; k++) {
              const t = targets[k];
              if (n - lastSpike[t] >= refSteps[t]) {
                const c = counts[k];
                g[t] += c * wSyn;
                if (c > 0) { srcId[t] = j; srcStep[t] = n; }
                if (inActive[t] === 0) { inActive[t] = 1; active[nActive++] = t; }
              }
            }
          }
        }
        ringN[slot] = 0;
      }
      if (nSpk) {                                 // this step's spikes are delivered at step n + D
        const dst = (n + D) % R;
        if (this.ringIds[dst].length < nSpk) this.ringIds[dst] = new Int32Array(Math.max(nSpk, this.ringIds[dst].length * 2));
        this.ringIds[dst].set(spkTmp.subarray(0, nSpk));
        ringN[dst] = nSpk;
      }

      // ---- synapses, part 2: Poisson input and replayed events add wPoi to v (skipped for refractory targets)
      for (const grp of this.groups.values()) {
        const ids = grp.ids, thr = grp.thr;
        for (let q = 0; q < ids.length; q++) {
          if (this.rng.nextU32() < thr) {
            const i = ids[q];
            if (n - lastSpike[i] >= refSteps[i]) {
              v[i] += wPoi;
              if (trackSrc) srcId[i] = -1;
              if (inActive[i] === 0) { inActive[i] = 1; active[nActive++] = i; }
            }
          }
        }
      }
      const evSteps = this.evSteps;
      while (this.evPos < evSteps.length && evSteps[this.evPos] <= n) {
        if (evSteps[this.evPos] === n) {
          const i = this.evIds[this.evPos];
          if (n - lastSpike[i] >= refSteps[i]) {
            v[i] += wPoi;
            if (trackSrc) srcId[i] = -1;
            if (inActive[i] === 0) { inActive[i] = 1; active[nActive++] = i; }
          }
        }
        this.evPos++;
      }

      // ---- resets, and record
      if (nSpk) {
        if (this.nOut + nSpk > this.outSteps.length) { this.outSteps = this._grow(this.outSteps); this.outIds = this._grow(this.outIds); }
        for (let q = 0; q < nSpk; q++) {
          const i = spkTmp[q];
          v[i] = vRst; g[i] = 0;
          this.outSteps[this.nOut] = n; this.outIds[this.nOut++] = i;
          if (trackSrc) {
            if (srcId[i] >= 0 && n - srcStep[i] <= SRC_LAG_STEPS) {
              if (this.nEdge === this.edgeSrc.length) { this.edgeSrc = this._grow(this.edgeSrc); this.edgeDst = this._grow(this.edgeDst); this.edgeStep = this._grow(this.edgeStep); }
              this.edgeSrc[this.nEdge] = srcId[i]; this.edgeDst[this.nEdge] = i; this.edgeStep[this.nEdge++] = n;
            }
            srcId[i] = -1;
          }
        }
        this.totalSpikes += nSpk;
      }
      this.step = n + 1;
    }
    this.nActive = nActive;
  }

  /** Return and clear the (source, target, step) triples recorded since the last call (trackSources only). */
  takeEdges() {
    if (!this.trackSources) return { src: new Int32Array(0), dst: new Int32Array(0), step: new Int32Array(0) };
    const out = { src: this.edgeSrc.slice(0, this.nEdge), dst: this.edgeDst.slice(0, this.nEdge), step: this.edgeStep.slice(0, this.nEdge) };
    this.nEdge = 0;
    return out;
  }

  /** Return and clear the spikes recorded since the last call: parallel arrays of step index and neuron index. */
  takeSpikes() {
    const out = { steps: this.outSteps.slice(0, this.nOut), ids: this.outIds.slice(0, this.nOut) };
    this.nOut = 0;
    return out;
  }
}
