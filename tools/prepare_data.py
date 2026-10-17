"""Build the static data files the page needs (site/data/) from the raw downloads in data/raw/.

  python tools/prepare_data.py

Outputs
  site/data/graph_full.fbg.gz        full v783 connectivity (all 15.09 M edges), FBG1 format (tools/graph_codec.py)
  site/data/graph_lite.fbg.gz        optional thresholded graph: only edges with >= 2 synapses
  site/data/graph_full.summary.json  independent checksums used by tests/graph.test.mjs
  site/data/neurons.bin.gz           per-neuron arrays (positions, class, transmitter, side, cell type)
  site/data/meta.json                section offsets, bounding box, class names, key neuron indices, credits
  results/data_sizes.json            sizes of every variant (raw / gzip -9 / brotli -q 11)
  results/nt_sign_check.json         agreement of the connectivity-file sign with the v783 top-NT annotation

Neuron index = row of Completeness_783.csv = Brian2 index of the reference runs.
Positions: FlyWire voxels are 4 x 4 x 40 nm. Display frame: x to the viewer's right, y up (dorsal), z toward the
viewer (anterior), i.e. a view onto the fly's face. Orientation was read off the data (olfactory neurons = anterior
= low z; gustatory = ventral = high y).
"""
import gzip, io, json, subprocess, sys, time
from pathlib import Path
ROOT = Path(__file__).resolve().parent.parent
sys.path.insert(0, str(ROOT / "tools")); sys.path.insert(0, str(ROOT / "reference"))
import numpy as np, pandas as pd, pyarrow.parquet as pq
import graph_codec as gc
import conditions

RAW = ROOT / "data/raw"; OUT = ROOT / "site/data"; OUT.mkdir(parents=True, exist_ok=True)
(ROOT / "results").mkdir(exist_ok=True)


def gz(b, path):
    with open(path, "wb") as f:                      # mtime=0 -> reproducible bytes
        with gzip.GzipFile(fileobj=f, mode="wb", compresslevel=9, mtime=0) as z:
            z.write(b)
    return Path(path).stat().st_size


def brotli_size(b):
    return len(subprocess.run(["brotli", "-q", "11", "-c"], input=b, capture_output=True, check=True).stdout)


def main():
    t0 = time.time()
    comp = pd.read_csv(RAW / "shiu/Completeness_783.csv", index_col=0)
    ids = comp.index.values.astype(np.int64)
    N = len(ids)
    idx_of = {int(r): i for i, r in enumerate(ids)}

    # ---------------- connectivity ----------------
    t = pq.read_table(RAW / "shiu/Connectivity_783.parquet",
                      columns=["Presynaptic_Index", "Postsynaptic_Index", "Excitatory x Connectivity"]).to_pandas()
    pre = t.Presynaptic_Index.values; post = t.Postsynaptic_Index.values; w = t["Excitatory x Connectivity"].values
    del t
    offsets, targets, counts = gc.to_csr(N, pre, post, w)
    E = len(targets)
    sizes = {}
    blob = gc.encode(N, offsets, targets, counts)
    sizes["graph_full"] = {"E": int(E), "raw": len(blob), "gzip9": gz(blob, OUT / "graph_full.fbg.gz"), "brotli11": brotli_size(blob)}
    deg = np.diff(offsets)
    spot = [int(i) for i in np.linspace(0, N - 1, 25).astype(int)] + [int(deg.argmax())] + [int(np.nonzero(deg == 0)[0][0])]
    spot_rows = [{"pre": i, "targets": targets[offsets[i]:offsets[i + 1]].tolist(), "counts": counts[offsets[i]:offsets[i + 1]].tolist()} for i in spot]
    (OUT / "graph_full.summary.json").write_text(json.dumps({
        "N": int(N), "E": int(E), "sum_abs_counts": int(np.abs(counts).sum()), "sum_signed_counts": int(counts.sum()),
        "sum_targets": int(targets.sum()), "spot_rows": spot_rows}))
    # lite graph: edges supported by >= 2 synapses
    keep = np.abs(counts) >= 2
    row_of = np.repeat(np.arange(N), deg)
    off2 = np.zeros(N + 1, dtype=np.int64); np.add.at(off2, row_of[keep] + 1, 1); off2 = np.cumsum(off2)
    blob2 = gc.encode(N, off2, targets[keep], counts[keep])
    sizes["graph_lite_ge2"] = {"E": int(keep.sum()), "raw": len(blob2), "gzip9": gz(blob2, OUT / "graph_lite.fbg.gz"), "brotli11": brotli_size(blob2),
                               "synapse_fraction_kept": float(np.abs(counts[keep]).sum() / np.abs(counts).sum())}
    sign = np.zeros(N, dtype=np.int8)
    sign[row_of[counts > 0]] = 1; sign[row_of[counts < 0]] = -1
    print(f"graph done {time.time()-t0:.0f}s", sizes["graph_full"], flush=True)

    # ---------------- annotations / positions ----------------
    ann = pd.read_csv(RAW / "annot/Supplemental_file1_neuron_annotations.tsv", sep="\t", low_memory=False).set_index("root_id")
    a = ann.reindex(ids)
    known = a.pos_x.notna().values
    anchor = np.stack([a.pos_x.values, a.pos_y.values, a.pos_z.values], 1).astype(np.float64)
    soma = np.stack([a.soma_x.values, a.soma_y.values, a.soma_z.values], 1).astype(np.float64)
    soma = np.where(np.isnan(soma), anchor, soma)
    um = np.array([4e-3, 4e-3, 40e-3])
    anchor_um = anchor * um; soma_um = soma * um
    # centre / frame: view = (-(x-cx), -(y-cy), -(z-cz)) with c the bbox centre of the anchor points; units: micrometres
    lo = np.nanmin(anchor_um, 0); hi = np.nanmax(anchor_um, 0); c = (lo + hi) / 2
    def to_view(p):
        return np.stack([-(p[:, 0] - c[0]), -(p[:, 1] - c[1]), -(p[:, 2] - c[2])], 1)
    va, vs = to_view(anchor_um), to_view(soma_um)
    vlo = np.nanmin(np.concatenate([va, vs]), 0); vhi = np.nanmax(np.concatenate([va, vs]), 0)
    def q16(p):
        out = np.zeros(p.shape, dtype=np.uint16)
        ok = ~np.isnan(p).any(1)
        out[ok] = np.clip(np.round((p[ok] - vlo) / (vhi - vlo) * 65535), 0, 65535).astype(np.uint16)
        return out
    qa, qs = q16(va), q16(vs)
    sc_names = ["optic", "central", "sensory", "visual_projection", "ascending", "descending", "sensory_ascending",
                "visual_centrifugal", "motor", "endocrine"]
    cls = np.full(N, 255, dtype=np.uint8)
    for k, nme in enumerate(sc_names): cls[(a.super_class == nme).values] = k
    nt_names = ["acetylcholine", "gaba", "glutamate", "dopamine", "serotonin", "octopamine"]
    nt = np.full(N, 255, dtype=np.uint8)
    for k, nme in enumerate(nt_names): nt[(a.top_nt == nme).values] = k
    side_names = ["left", "right", "center"]
    side = np.full(N, 255, dtype=np.uint8)
    for k, nme in enumerate(side_names): side[(a.side == nme).values] = k
    types = sorted({str(x) for x in a.cell_type.dropna().unique()})
    tix = {s: i + 1 for i, s in enumerate(types)}          # 0 = unlabelled
    ctype = np.array([tix.get(str(x), 0) if isinstance(x, str) else 0 for x in a.cell_type.values], dtype=np.uint16)
    assert len(types) < 65535
    cls_sub = a.cell_class.fillna("").values
    sections = {}
    buf = io.BytesIO()
    def put(name, arr):
        pad = (-buf.tell()) % 4
        buf.write(b"\0" * pad)
        sections[name] = {"offset": buf.tell(), "dtype": str(arr.dtype), "shape": list(arr.shape)}
        buf.write(arr.astype("<" + arr.dtype.str[1:]).tobytes())
    put("pos_anchor", qa); put("pos_soma", qs); put("super_class", cls); put("nt", nt); put("side", side); put("cell_type", ctype)
    sign_u8 = np.where(sign > 0, 1, np.where(sign < 0, 2, 0)).astype(np.uint8)
    put("sign", sign_u8)
    nbytes = len(buf.getvalue())
    sizes["neurons"] = {"raw": nbytes, "gzip9": gz(buf.getvalue(), OUT / "neurons.bin.gz")}

    # ---------------- key neurons ----------------
    L = conditions.lists("783")
    key = {k: [idx_of[int(x)] for x in v] for k, v in L.items() if isinstance(v, list)}
    key["mn9_contra"] = idx_of[int(L["mn9_contra"])]; key["mn9_ipsi"] = idx_of[int(L["mn9_ipsi"])]
    # sanity: annotation sub-classes of the paper's sets
    comp_sets = {k: a.iloc[v].cell_sub_class.fillna("?").value_counts().to_dict() for k, v in key.items() if isinstance(v, list)}
    meta = {
        "dataset": "FlyWire v783 (public release), Shiu et al. 2024 connectivity file", "N": int(N), "E": int(E),
        "n_annotated": int(known.sum()), "sections": sections, "types": types,
        "super_class_names": sc_names, "nt_names": nt_names, "side_names": side_names, "sign_names": ["none", "excitatory", "inhibitory"],
        "bbox_um": {"lo": vlo.tolist(), "hi": vhi.tolist()},
        "frame": "x to viewer's right, y up (dorsal), z toward viewer (anterior); micrometres from the bbox centre; "
                 "FlyWire voxel = 4x4x40 nm",
        "key": key, "key_cell_subclass_in_v783_annotation": comp_sets,
        "ids": {"mn9_contra": int(L["mn9_contra"]), "mn9_ipsi": int(L["mn9_ipsi"])},
        "root_id_note": "neuron index i = row i of Completeness_783.csv; root ids are not shipped except via tools",
        "credits": "FlyWire connectome: Dorkenwald et al. 2024, Schlegel et al. 2024 (CC-BY 4.0). Model/connectivity file: Shiu et al. 2024 (MIT).",
    }
    (OUT / "meta.json").write_text(json.dumps(meta))

    # transmitter -> sign agreement (documented honestly)
    exp_sign = {"acetylcholine": 1, "dopamine": 1, "serotonin": 1, "octopamine": 1, "gaba": -1, "glutamate": -1}
    es = a.top_nt.map(exp_sign).values
    have = (sign != 0) & ~pd.isna(es)
    agree = float((es[have] == sign[have]).mean())
    ct = pd.crosstab(a.top_nt.fillna("NA"), pd.Series(sign, index=a.index).map({-1: "inh", 0: "no_out", 1: "exc"}))
    (ROOT / "results/nt_sign_check.json").write_text(json.dumps({
        "n_with_outputs_and_annotation_nt": int(have.sum()), "agreement_with_ach_da_5ht_oa_exc__gaba_glu_inh": agree,
        "n_exc": int((sign > 0).sum()), "n_inh": int((sign < 0).sum()), "n_no_outputs": int((sign == 0).sum()),
        "crosstab_top_nt_vs_sign": ct.to_dict()}, indent=1))
    (ROOT / "results/data_sizes.json").write_text(json.dumps(sizes, indent=1))
    print(json.dumps(sizes, indent=1)); print("sign agreement", agree, " time", time.time() - t0)


if __name__ == "__main__":
    main()
