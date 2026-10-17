"""Encoder for the FBG1 compact connectivity format read by site/engine/graph.js (decodeGraph).

Layout (little endian): "FBG1", u32 N, u32 E, u32 flags, u32 len_outdeg, u32 len_targets, u32 len_weights,
u32 reserved, then ceil(N/8) bytes of inhibitory bits, then three LEB128 varint streams: out-degrees (N),
target deltas within each row (E; first of a row absolute), synapse-count magnitudes (E).
The sign of an edge is a property of the presynaptic neuron (predicted neurotransmitter).
"""
import struct
import numpy as np


def varint(vals):
    """LEB128-encode an array of non-negative integers (vectorised)."""
    vals = np.asarray(vals).astype(np.uint64)
    nb = 1 + (vals >= (1 << 7)).astype(np.int64) + (vals >= (1 << 14)) + (vals >= (1 << 21)) + (vals >= (1 << 28))
    ends = np.cumsum(nb)
    starts = ends - nb
    out = np.zeros(int(ends[-1]) if len(ends) else 0, dtype=np.uint8)
    for k in range(5):
        m = nb > k
        out[starts[m] + k] = ((vals[m] >> np.uint64(7 * k)) & np.uint64(0x7F)).astype(np.uint8) | ((nb[m] > k + 1).astype(np.uint8) << 7)
    return out


def to_csr(N, pre, post, cnt):
    """Sort edges by (pre, post). Returns offsets, targets, signed counts (int64 arrays)."""
    pre = np.asarray(pre, dtype=np.int64); post = np.asarray(post, dtype=np.int64); cnt = np.asarray(cnt, dtype=np.int64)
    o = np.lexsort((post, pre))
    pre, post, cnt = pre[o], post[o], cnt[o]
    offsets = np.zeros(N + 1, dtype=np.int64)
    np.add.at(offsets, pre + 1, 1)
    offsets = np.cumsum(offsets)
    return offsets, post, cnt


def encode(N, offsets, targets, counts):
    """Encode a CSR graph whose per-row sign is constant (asserted)."""
    E = len(targets)
    deg = np.diff(offsets)
    row_of = np.repeat(np.arange(N), deg)
    neg = np.zeros(N, dtype=bool)
    has_neg = np.bincount(row_of[counts < 0], minlength=N) > 0
    has_pos = np.bincount(row_of[counts > 0], minlength=N) > 0
    assert not (has_neg & has_pos).any(), "mixed signs within a presynaptic neuron"
    neg = has_neg
    delta = targets.copy()
    delta[1:] = targets[1:] - targets[:-1]
    first = np.zeros(E, dtype=bool)
    starts = offsets[:-1][deg > 0]
    first[starts] = True
    delta[first] = targets[first]
    assert (delta >= 0).all()
    signbits = np.packbits(neg.astype(np.uint8), bitorder="little").tobytes()
    s_deg = varint(deg).tobytes(); s_tgt = varint(delta).tobytes(); s_w = varint(np.abs(counts)).tobytes()
    header = b"FBG1" + struct.pack("<7I", N, E, 1, len(s_deg), len(s_tgt), len(s_w), 0)
    return header + signbits + s_deg + s_tgt + s_w
