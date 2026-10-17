"""Cross-language fixture for the FBG1 codec: a tiny random graph encoded in Python, expected arrays in JSON."""
import json, sys
from pathlib import Path
ROOT = Path(__file__).resolve().parent.parent.parent
sys.path.insert(0, str(ROOT / "tools"))
import numpy as np
import graph_codec as gc

rng = np.random.default_rng(5)
N = 61
sign = np.where(rng.random(N) < 0.35, -1, 1)
pre, post = np.nonzero(rng.random((N, N)) < 0.12)
keep = pre != post
pre, post = pre[keep], post[keep]
cnt = np.maximum(1, rng.integers(1, 40, size=len(pre)))
cnt[rng.random(len(pre)) < 0.03] = 2405                      # exercise multi-byte varints
cnt = cnt * sign[pre]
post[0] = N - 1 if post[0] != N - 1 else post[0]            # keep a far target in row 0
off, tgt, c = gc.to_csr(N, pre, post, cnt)
# make sure a row has a gap > 16383 is impossible at N=61, so also exercise via the big-N unit below
blob = gc.encode(N, off, tgt, c)
(ROOT / "tests/fixtures/graph_small.fbg").write_bytes(blob)
(ROOT / "tests/fixtures/graph_small.json").write_text(json.dumps({"N": N, "E": int(len(tgt)), "offsets": off.tolist(), "targets": tgt.tolist(), "counts": c.tolist()}))
print("graph_small:", N, len(tgt), len(blob), "bytes")
