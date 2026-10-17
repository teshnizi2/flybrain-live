"""Run one Shiu et al. 2024 gustatory condition with the authors' own Brian2 model (unmodified model.py).

The only differences from model.run_exp are bookkeeping: the network is built once and the trials are
run in a loop (store/restore) instead of once per joblib worker, and we keep per-neuron spike counts
instead of full spike trains. Model construction (create_model), Poisson input (poi) and equations are
imported from the upstream file untouched.

  python reference/run_brian2.py --graph 783 --cond sugar_100 --trials 30
Output: results/reference/brian2_<graph>_<cond>.json
"""
import argparse, json, resource, sys, time, platform
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
sys.path.insert(0, str(ROOT / "data/raw/shiu"))   # upstream model.py (MIT), downloaded by tools/fetch_data.sh
sys.path.insert(0, str(ROOT / "reference"))
import numpy as np, pandas as pd
import brian2
from brian2 import Network, Hz, ms, seed, prefs
prefs.codegen.target = "cython"
from model import default_params, create_model, poi
import conditions

ap = argparse.ArgumentParser()
ap.add_argument("--graph", default="783", choices=["630", "783"])
ap.add_argument("--cond", required=True)
ap.add_argument("--trials", type=int, default=30)
ap.add_argument("--seed0", type=int, default=0)
ap.add_argument("--t_run_ms", type=float, default=1000.0)
ap.add_argument("--out", default=None)
a = ap.parse_args()

if a.graph == "783":
    comp_p = ROOT / "data/raw/shiu/Completeness_783.csv"; con_p = ROOT / "data/raw/shiu/Connectivity_783.parquet"
else:
    comp_p = ROOT / "data/raw/shiu630/2023_03_23_completeness_630_final.csv"
    con_p = ROOT / "data/raw/shiu630/2023_03_23_connectivity_630_final.parquet"
out_p = Path(a.out) if a.out else ROOT / f"results/reference/brian2_{a.graph}_{a.cond}.json"

params = dict(default_params)
exc_ids, r1, exc2_ids, r2 = conditions.resolve(a.cond, a.graph)
params["r_poi"] = r1 * Hz
params["r_poi2"] = r2 * Hz
params["t_run"] = a.t_run_ms * ms

comp = pd.read_csv(comp_p, index_col=0)
root_ids = comp.index.values
flyid2i = {int(j): i for i, j in enumerate(root_ids)}
L = conditions.lists(a.graph)

t0 = time.time()
neu, syn, spk_mon = create_model(comp_p, con_p, params)
exc = [flyid2i[n] for n in exc_ids]; exc2 = [flyid2i[n] for n in exc2_ids]
pois, neu = poi(neu, exc, exc2, params)
net = Network(neu, syn, spk_mon, *pois)
net.store("init")
t_build = time.time() - t0
n_syn = len(syn)
print(f"[{a.cond}] built {len(root_ids)} neurons / {n_syn} synapses in {t_build:.1f}s", flush=True)

mn9 = {"contra": flyid2i[L["mn9_contra"]], "ipsi": flyid2i[L["mn9_ipsi"]]}
counts = np.zeros((a.trials, len(root_ids)), dtype=np.int32)
mn9_times = {k: [] for k in mn9}
trial_wall = []
for k in range(a.trials):
    net.restore("init")
    seed(a.seed0 + k)
    t1 = time.time()
    net.run(params["t_run"])
    trial_wall.append(time.time() - t1)
    counts[k] = spk_mon.count[:]
    trains = spk_mon.spike_trains()
    for name, idx in mn9.items():
        mn9_times[name].append([round(float(x) * 1000, 1) for x in trains[idx]])  # ms
    print(f"[{a.cond}] trial {k}: {counts[k].sum()} spikes, {int((counts[k] > 0).sum())} neurons, "
          f"MN9 contra {len(mn9_times['contra'][-1])} ipsi {len(mn9_times['ipsi'][-1])}, {trial_wall[-1]:.1f}s", flush=True)

t_run_s = a.t_run_ms / 1000.0
active_any = np.where(counts.sum(0) > 0)[0]
res = {
    "engine": "brian2", "brian2_version": brian2.__version__, "codegen_target": "cython",
    "python": platform.python_version(), "machine": platform.machine(),
    "graph": a.graph, "condition": a.cond, "n_trials": a.trials, "t_run_ms": a.t_run_ms, "seed0": a.seed0,
    "stimulus": {"group_a_hz": r1, "n_a": len(exc), "group_b_hz": r2, "n_b": len(exc2)},
    "model_params": {k: str(v) for k, v in default_params.items() if k not in ("eqs", "eq_th", "eq_rst")},
    "n_neurons": len(root_ids), "n_synapses": int(n_syn),
    "mn9_ids": {"contra": int(L["mn9_contra"]), "ipsi": int(L["mn9_ipsi"])},
    "mn9_rate_hz": {n: {"mean": float(counts[:, i].mean() / t_run_s), "std": float(counts[:, i].std() / t_run_s),
                        "per_trial": (counts[:, i] / t_run_s).tolist(),
                        "trials_with_spikes": int((counts[:, i] > 0).sum())} for n, i in mn9.items()},
    "mn9_spike_times_ms": mn9_times,
    "n_active_neurons_mean_per_trial": float((counts > 0).sum(1).mean()),
    "n_responding_neurons_any_trial": int(len(active_any)),   # >0 Hz in the mean over trials, the paper's definition
    "total_spikes_per_trial": counts.sum(1).tolist(),
    "per_neuron_counts": {str(int(root_ids[i])): counts[:, i].tolist() for i in active_any},
    "wall": {"build_s": t_build, "trial_s": trial_wall, "max_rss_mb": resource.getrusage(resource.RUSAGE_SELF).ru_maxrss / 1e6},
}
out_p.parent.mkdir(parents=True, exist_ok=True)
out_p.write_text(json.dumps(res))
print(f"[{a.cond}] wrote {out_p} ({out_p.stat().st_size/1e3:.0f} kB); MN9 contra {res['mn9_rate_hz']['contra']['mean']:.1f} Hz", flush=True)
