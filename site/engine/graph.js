// Connectivity in compressed-sparse-row form + the compact FBG1 binary format (see tools/graph_codec.py).
//
//   CSR: { N, E, offsets: Uint32Array(N+1), targets: Int32Array(E), counts: Int16Array(E) }
//   counts[k] is the signed synapse count of edge k: (number of synapses) x (+1 excitatory, -1 inhibitory).
//   The sign belongs to the presynaptic neuron (predicted neurotransmitter), exactly as in Shiu et al.'s
//   'Excitatory x Connectivity' column.

/** Build a CSR graph from edge lists (any order); each row is sorted by target. */
export function csrFromEdges(N, pre, post, cnt) {
  const E = pre.length;
  const offsets = new Uint32Array(N + 1);
  for (let k = 0; k < E; k++) offsets[pre[k] + 1]++;
  for (let i = 0; i < N; i++) offsets[i + 1] += offsets[i];
  const fill = offsets.slice(0, N);
  const targets = new Int32Array(E), counts = new Int16Array(E);
  for (let k = 0; k < E; k++) { const p = fill[pre[k]]++; targets[p] = post[k]; counts[p] = cnt[k]; }
  // sort every row by target (rows are short; insertion/array sort on index permutation)
  for (let i = 0; i < N; i++) {
    const a = offsets[i], b = offsets[i + 1];
    if (b - a < 2) continue;
    const idx = Array.from({ length: b - a }, (_, q) => q).sort((x, y) => targets[a + x] - targets[a + y]);
    const t = idx.map(q => targets[a + q]), c = idx.map(q => counts[a + q]);
    for (let q = 0; q < b - a; q++) { targets[a + q] = t[q]; counts[a + q] = c[q]; }
  }
  return { N, E, offsets, targets, counts };
}

/**
 * Decode the FBG1 container (already gunzipped).
 * Layout (little endian): "FBG1", u32 N, u32 E, u32 flags, u32 len_outdeg, u32 len_targets, u32 len_weights,
 * u32 reserved, then ceil(N/8) bytes of inhibitory bits (bit i of byte i>>3), then three LEB128 varint streams:
 * out-degrees (N values), target deltas within each row (E values; first of a row is absolute),
 * synapse-count magnitudes (E values).
 */
export function decodeGraph(arrayBuffer) {
  const u8 = new Uint8Array(arrayBuffer);
  if (u8.length < 32 || u8[0] !== 0x46 || u8[1] !== 0x42 || u8[2] !== 0x47 || u8[3] !== 0x31) throw new Error('not an FBG1 graph');
  const dv = new DataView(arrayBuffer);
  const N = dv.getUint32(4, true), E = dv.getUint32(8, true);
  const lenDeg = dv.getUint32(16, true), lenTgt = dv.getUint32(20, true), lenW = dv.getUint32(24, true);
  let p = 32;
  const signBytes = (N + 7) >> 3;
  const sign = u8.subarray(p, p + signBytes); p += signBytes;
  const degEnd = p + lenDeg; const tgtEnd = degEnd + lenTgt; const wEnd = tgtEnd + lenW;
  if (wEnd > u8.length) throw new Error('truncated FBG1 graph');

  const offsets = new Uint32Array(N + 1);
  let q = p;
  for (let i = 0; i < N; i++) {
    let b = u8[q++], x = b & 127, sh = 7;
    while (b & 128) { b = u8[q++]; x |= (b & 127) << sh; sh += 7; }
    offsets[i + 1] = offsets[i] + x;
  }
  if (offsets[N] !== E) throw new Error(`degree sum ${offsets[N]} != E ${E}`);

  const targets = new Int32Array(E), counts = new Int16Array(E);
  q = degEnd; let wq = tgtEnd;
  for (let i = 0; i < N; i++) {
    const a = offsets[i], b2 = offsets[i + 1];
    const neg = (sign[i >> 3] >> (i & 7)) & 1;
    let prev = 0;
    for (let k = a; k < b2; k++) {
      let b = u8[q++], x = b & 127, sh = 7;
      while (b & 128) { b = u8[q++]; x |= (b & 127) << sh; sh += 7; }
      prev += x; targets[k] = prev;
      b = u8[wq++]; x = b & 127; sh = 7;
      while (b & 128) { b = u8[wq++]; x |= (b & 127) << sh; sh += 7; }
      counts[k] = neg ? -x : x;
    }
  }
  return { N, E, offsets, targets, counts };
}
