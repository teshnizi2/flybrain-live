"""Deterministic replay on the FULL network: explicit input events instead of PoissonInput.

Same events -> the JS engine (tests/replay.test.mjs) must reproduce Brian2's spike trains. The events are injected in
the 'synapses' slot (after the synaptic pathway, like PoissonInput) and dropped for refractory targets, exactly as the
generated PoissonInput code does ('if not_refractory: v += weight * binomial()').

  python reference/replay_brian2.py --graph 783 --cond sugar_100 --steps 10000 --seed 123
Output: results/reference/replay_<graph>_<cond>.json   {events: [[step, neuron_index]...], spikes: [[step, neuron_index]...]}
"""
import argparse, json, sys, time
from pathlib import Path
ROOT = Path(__file__).resolve().parent.parent
sys.path.insert(0, str(ROOT / "data/raw/shiu")); sys.path.insert(0, str(ROOT / "reference"))
import numpy as np, pandas as pd
import brian2
from brian2 import Network, Hz, ms, network_operation, prefs, defaultclock
prefs.codegen.target = "cython"
from model import default_params, create_model, poi
import conditions

ap = argparse.ArgumentParser()
ap.add_argument("--graph", default="783"); ap.add_argument("--cond", default="sugar_100")
ap.add_argument("--steps", type=int, default=10000); ap.add_argument("--seed", type=int, default=123)
a = ap.parse_args()
if a.graph == "783":
    comp_p = ROOT / "data/raw/shiu/Completeness_783.csv"; con_p = ROOT / "data/raw/shiu/Connectivity_783.parquet"
else:
    comp_p = ROOT / "data/raw/shiu630/2023_03_23_completeness_630_final.csv"; con_p = ROOT / "data/raw/shiu630/2023_03_23_connectivity_630_final.parquet"
params = dict(default_params)
exc_ids, r1, exc2_ids, r2 = conditions.resolve(a.cond, a.graph)
comp = pd.read_csv(comp_p, index_col=0)
flyid2i = {int(j): i for i, j in enumerate(comp.index)}
exc = [flyid2i[n] for n in exc_ids]; exc2 = [flyid2i[n] for n in exc2_ids]

# events: Bernoulli(rate * dt) per step and target, as PoissonInput(N=1) draws
dt = 1e-4
rng = np.random.default_rng(a.seed)
events = []
for ids, rate in ((exc, r1), (exc2, r2)):
    if rate <= 0: continue
    hit = rng.random((a.steps, len(ids))) < rate * dt
    s, k = np.nonzero(hit)
    events += [(int(si), int(ids[ki])) for si, ki in zip(s, k)]
events.sort()
by_step = {}
for s, i in events: by_step.setdefault(s, []).append(i)

neu, syn, spk_mon = create_model(comp_p, con_p, params)
for i in exc + exc2:
    neu[i].rfc = 0 * ms                       # model.py poi(): no refractory period for Poisson targets
notref = neu.variables["not_refractory"].get_value
vv = neu.variables["v"].get_value
weight = float(params["w_syn"] * params["f_poi"])
counter = [0]

@network_operation(when="synapses", order=1)   # after default_synapses_pre (order -1); PoissonInput has order 0, same slot
def inject():
    s = counter[0]
    for i in by_step.get(s, ()):
        if notref()[i]:
            vv()[i] += weight
    counter[0] += 1

net = Network(neu, syn, spk_mon, inject)
t0 = time.time()
net.run(a.steps * defaultclock.dt)
spikes = sorted((int(round(float(t) / 1e-4)), int(i)) for i, t in zip(spk_mon.i[:], spk_mon.t[:]))
out = {"graph": a.graph, "condition": a.cond, "steps": a.steps, "seed": a.seed, "brian2_version": brian2.__version__,
       "n_events": len(events), "n_spikes": len(spikes), "run_s": time.time() - t0, "events": events, "spikes": spikes}
p = ROOT / f"results/reference/replay_{a.graph}_{a.cond}.json"
p.write_text(json.dumps(out))
print(f"replay {a.graph}/{a.cond}: {len(events)} events -> {len(spikes)} spikes in {out['run_s']:.1f}s; {p.stat().st_size/1e3:.0f} kB")
