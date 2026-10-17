"""Pack another connectivity file (e.g. the v630 one, used only for validation against the authors' shipped outputs)
into FBG1:  python tools/pack_graph.py 630 tmp/graph_630.fbg.gz"""
import gzip, sys
from pathlib import Path
ROOT = Path(__file__).resolve().parent.parent
sys.path.insert(0, str(ROOT / "tools"))
import numpy as np, pandas as pd, pyarrow.parquet as pq
import graph_codec as gc
ver, out = sys.argv[1], Path(ROOT / sys.argv[2])
if ver == "630":
    comp = ROOT / "data/raw/shiu630/2023_03_23_completeness_630_final.csv"; con = ROOT / "data/raw/shiu630/2023_03_23_connectivity_630_final.parquet"
else:
    comp = ROOT / "data/raw/shiu/Completeness_783.csv"; con = ROOT / "data/raw/shiu/Connectivity_783.parquet"
N = len(pd.read_csv(comp, index_col=0))
t = pq.read_table(con, columns=["Presynaptic_Index", "Postsynaptic_Index", "Excitatory x Connectivity"]).to_pandas()
off, tgt, cnt = gc.to_csr(N, t.Presynaptic_Index.values, t.Postsynaptic_Index.values, t["Excitatory x Connectivity"].values)
out.parent.mkdir(parents=True, exist_ok=True)
with open(out, "wb") as f, gzip.GzipFile(fileobj=f, mode="wb", compresslevel=6, mtime=0) as z:
    z.write(gc.encode(N, off, tgt, cnt))
print(ver, "N", N, "E", len(tgt), out.stat().st_size / 1e6, "MB")
