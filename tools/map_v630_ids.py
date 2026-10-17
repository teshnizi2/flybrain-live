"""Map FlyWire v630 root IDs (used in the Shiu et al. notebooks) to v783 root IDs.

Why: the notebooks list neuron IDs from FlyWire v630, but this project uses the v783 release.
A neuron that was proofread/merged between the releases gets a new root ID, so a few IDs are
missing from v783 (e.g. one sugar GRN, one bitter GRN, one MN9).

Method: a neuron whose ID disappeared keeps (almost all of) its synaptic partners, so we pick the
v783-only neuron whose partner vector (outputs and inputs, over partners whose IDs exist in both
releases) has the highest cosine similarity with the v630 neuron's. We print the best and
runner-up score so a human can judge ambiguity. Output: results/id_mapping_630_to_783.json

Usage:  python tools/map_v630_ids.py
"""
import json, sys
import numpy as np, pandas as pd, pyarrow.parquet as pq
from scipy import sparse

RAW = "data/raw/"
MISSING = {
    "sugar":  [720575940620900446],
    "bitter": [720575940618600651],
    "mn9_paper_other_side": [720575940645521262],
}
c630 = pd.read_csv(RAW + "shiu630/2023_03_23_completeness_630_final.csv", index_col=0).index.values
c783 = pd.read_csv(RAW + "shiu/Completeness_783.csv", index_col=0).index.values
both = np.intersect1d(c630, c783)
only783 = np.setdiff1d(c783, c630)
only630 = np.setdiff1d(c630, c783)
print(f"v630 neurons {len(c630)}, v783 neurons {len(c783)}, shared {len(both)}, only630 {len(only630)}, only783 {len(only783)}")

cols = ["Presynaptic_ID", "Postsynaptic_ID", "Excitatory x Connectivity"]
t630 = pq.read_table(RAW + "shiu630/2023_03_23_connectivity_630_final.parquet", columns=cols).to_pandas()
t783 = pq.read_table(RAW + "shiu/Connectivity_783.parquet", columns=cols).to_pandas()
t630.columns = t783.columns = ["pre", "post", "w"]
t630["w"] = t630.w.abs().astype(np.float32); t783["w"] = t783.w.abs().astype(np.float32)

idx = pd.Series(np.arange(len(both)), index=both)  # shared partners get a column index
def vec(table, nid):
    out = table[table.pre == nid]; inn = table[table.post == nid]
    v = np.zeros(2 * len(both), dtype=np.float32)
    o = idx.reindex(out.post.values); m = o.notna().values
    np.add.at(v, o.values[m].astype(int), out.w.values[m])
    i = idx.reindex(inn.pre.values); m = i.notna().values
    np.add.at(v, len(both) + i.values[m].astype(int), inn.w.values[m])
    return v

# candidate vectors for v783-only neurons (build via sparse matrices for speed)
cand = pd.Series(np.arange(len(only783)), index=only783)
def sparse_vecs(table, key_ids, key_col, partner_col, offset):
    sel = table[table[key_col].isin(only783)]
    r = cand.reindex(sel[key_col].values).values.astype(int)
    c = idx.reindex(sel[partner_col].values); m = c.notna().values
    return sparse.csr_matrix((sel.w.values[m], (r[m], c.values[m].astype(int) + offset)),
                             shape=(len(only783), 2 * len(both)))
M = sparse_vecs(t783, only783, "pre", "post", 0) + sparse_vecs(t783, only783, "post", "pre", len(both))
Mn = np.sqrt(M.multiply(M).sum(axis=1)).A1 + 1e-9

res = {}
for group, ids in MISSING.items():
    for nid in ids:
        assert nid in set(c630) and nid not in set(c783), nid
        v = vec(t630, nid); vn = np.linalg.norm(v) + 1e-9
        sims = (M @ v) / (Mn * vn)
        order = np.argsort(-sims)[:3]
        best = [(int(only783[k]), float(sims[k])) for k in order]
        print(group, nid, "->", best)
        res[str(nid)] = {"group": group, "best": best[0][0], "cosine_best": best[0][1],
                         "runner_up": best[1][0], "cosine_runner_up": best[1][1],
                         "partners_in_v630": int((v > 0).sum())}
json.dump(res, open("results/id_mapping_630_to_783.json", "w"), indent=1)
