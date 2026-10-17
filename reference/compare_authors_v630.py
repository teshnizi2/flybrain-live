"""Compare our runs (Brian2 and the JS engine, FlyWire v630 graph) with the authors' SHIPPED spike data.

philshiu/Drosophila_brain_model/results/example/{sugarR,sugarR_100Hz}.parquet are the authors' own outputs of
example.ipynb (v630 connectivity, 30 trials x 1 s). The GRN firing rate inside the file reveals the stimulus: sugarR was
run at 200 Hz (the notebook text says so; model.py's default of 150 Hz was changed later), sugarR_100Hz at 100 Hz.

  python reference/compare_authors_v630.py     ->  results/paper_numbers.json, results/validation_vs_authors_v630.json
"""
import json, sys
from pathlib import Path
ROOT = Path(__file__).resolve().parent.parent
import numpy as np, pandas as pd

MN9_CONTRA, MN9_IPSI = 720575940660219265, 720575940645521262
SUGAR = [720575940624963786, 720575940630233916, 720575940637568838]
files = {"sugar_200": "sugarR.parquet", "sugar_100": "sugarR_100Hz.parquet"}
shipped = {}
for cond, f in files.items():
    df = pd.read_parquet(ROOT / "data/raw/shiu/results_example" / f)
    n = df.trial.nunique()
    cnt = df.groupby(["flywire_id", "trial"]).size().unstack(fill_value=0).reindex(columns=range(n), fill_value=0)
    rate = cnt.mean(axis=1)                                    # Hz (1 s trials)
    grn = df[df.flywire_id.isin(SUGAR)].groupby(["flywire_id", "trial"]).size().mean()
    mn = {k: cnt.loc[i].values if i in cnt.index else np.zeros(n) for k, i in (("contra", MN9_CONTRA), ("ipsi", MN9_IPSI))}
    shipped[cond] = {"file": f, "n_trials": int(n), "grn_rate_hz": float(grn), "n_neurons_any_spike": int(cnt.shape[0]),
                     "spikes_per_trial": float(len(df) / n), "rate": rate,
                     "mn9": {k: {"mean": float(v.mean()), "std": float(v.std()), "per_trial": v.astype(float).tolist()} for k, v in mn.items()}}

paper_text = {
    "source": "Shiu et al., Nature 634:210-219 (2024), doi:10.1038/s41586-024-07763-9; text quoted from the open-access full text (PMC11446845)",
    "robust_activation": "modelling using the correct connectome results in robust activation of MN9 in 100% of simulations when sugar-sensing neurons are activated at 100 Hz (1 of 100 shuffled simulations did)",
    "responding_neurons": {"of_total_neurons_modelled": 127400, "at_10Hz": 45, "at_200Hz": 455, "definition": "neurons with greater than 0 Hz firing (v630)"},
    "calibration": "W_syn chosen such that sugar GRNs at 100 Hz give roughly 80% of maximal MN9 firing",
    "protocol": "30 simulations of 1,000 ms per experiment; Poisson-distributed input to the GRNs",
    "qualitative": ["unilateral sugar GRN activation drives the contralateral MN9 more strongly than the ipsilateral MN9",
                    "bitter GRN activity added to sugar activation inhibits MN6 and MN9; strong bitter eliminates MN9 firing to strong sugar, strong Ir94e does not",
                    "water and sugar GRNs act synergistically on MN9"],
    "equal_mn9_40Hz": {"sugar_pathway_neurons": 377, "water_pathway_neurons": 391},
}
(ROOT / "results/paper_numbers.json").write_text(json.dumps({
    "paper_text": paper_text,
    "authors_shipped_outputs_v630": {c: {k: v for k, v in s.items() if k != "rate"} for c, s in shipped.items()}}, indent=1))

def load_counts(path):
    r = json.load(open(path))
    return r, {int(k): np.array(v, float) for k, v in r["per_neuron_counts"].items()}

out = {}
for engine in ("brian2", "js"):
    for cond in files:
        p = ROOT / f"results/reference/{engine}_630_{cond}.json"
        if not p.exists(): continue
        r, pn = load_counts(p)
        sh = shipped[cond]
        ours = pd.Series({k: v.mean() / (r["t_run_ms"] / 1000) for k, v in pn.items()})
        both = sh["rate"].index.union(ours.index)
        a = sh["rate"].reindex(both, fill_value=0.0); b = ours.reindex(both, fill_value=0.0)
        sel = (a >= 0.5) | (b >= 0.5)
        res = {"n_trials": r["n_trials"], "pearson_r_rates_ge_0.5Hz": float(np.corrcoef(a[sel], b[sel])[0, 1]), "n_neurons_compared": int(sel.sum()),
               "n_responding": {"ours": int(len(ours)), "shipped": sh["n_neurons_any_spike"]},
               "spikes_per_trial": {"ours": float(np.mean(r["total_spikes_per_trial"])), "shipped": sh["spikes_per_trial"]}}
        for k in ("contra", "ipsi"):
            x = np.array(r["mn9_rate_hz"][k]["per_trial"]); y = np.array(sh["mn9"][k]["per_trial"])
            se = np.sqrt(x.var(ddof=1) / len(x) + y.var(ddof=1) / len(y))
            res["mn9_" + k] = {"ours_mean": float(x.mean()), "ours_sd": float(x.std()), "shipped_mean": float(y.mean()), "shipped_sd": float(y.std()),
                               "z": float((x.mean() - y.mean()) / se)}
        out[f"{engine}_{cond}"] = res
        print(engine, cond, json.dumps({k: (round(v, 3) if isinstance(v, float) else v) for k, v in res.items() if k.startswith("pearson")}),
              "MN9 contra ours %.1f shipped %.1f (z %.2f)" % (res["mn9_contra"]["ours_mean"], res["mn9_contra"]["shipped_mean"], res["mn9_contra"]["z"]))
(ROOT / "results/validation_vs_authors_v630.json").write_text(json.dumps(out, indent=1))
