import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import zlib from 'node:zlib';
import { csrFromEdges, decodeGraph } from '../site/engine/graph.js';

test('csrFromEdges sorts each row by target and keeps signed counts', () => {
  const g = csrFromEdges(4, [2, 0, 0, 2, 1], [3, 2, 1, 0, 3], [7, -4, 5, 1, 9]);
  assert.deepEqual(Array.from(g.offsets), [0, 2, 3, 5, 5]);
  assert.deepEqual(Array.from(g.targets), [1, 2, 3, 0, 3]);
  assert.deepEqual(Array.from(g.counts), [5, -4, 9, 1, 7]);
  assert.equal(g.N, 4); assert.equal(g.E, 5);
});

test('decodeGraph reads the Python-encoded FBG1 format (small cross-language fixture)', () => {
  const dir = new URL('./fixtures/', import.meta.url);
  const exp = JSON.parse(fs.readFileSync(new URL('graph_small.json', dir), 'utf8'));
  const buf = fs.readFileSync(new URL('graph_small.fbg', dir));
  const g = decodeGraph(buf.buffer.slice(buf.byteOffset, buf.byteOffset + buf.byteLength));
  assert.equal(g.N, exp.N); assert.equal(g.E, exp.E);
  assert.deepEqual(Array.from(g.offsets), exp.offsets);
  assert.deepEqual(Array.from(g.targets), exp.targets);
  assert.deepEqual(Array.from(g.counts), exp.counts);
});

test('decodeGraph rejects a bad magic number', () => {
  const b = new Uint8Array(64); b.set([0x4e, 0x4f, 0x50, 0x45]);
  assert.throws(() => decodeGraph(b.buffer), /FBG1/);
});

// The shipped graph, if it has been built (tools/prepare_data.py), must match the independent summary written by the packer.
const shipped = new URL('../site/data/graph_full.fbg.gz', import.meta.url);
const summary = new URL('../site/data/graph_full.summary.json', import.meta.url);
test('shipped full graph decodes to the checksums recorded by the Python packer', { skip: !fs.existsSync(shipped) }, () => {
  const exp = JSON.parse(fs.readFileSync(summary, 'utf8'));
  const raw = zlib.gunzipSync(fs.readFileSync(shipped));
  const g = decodeGraph(raw.buffer.slice(raw.byteOffset, raw.byteOffset + raw.byteLength));
  assert.equal(g.N, exp.N); assert.equal(g.E, exp.E);
  let sumAbs = 0, sumSigned = 0, sumTargets = 0;
  for (let k = 0; k < g.E; k++) { const c = g.counts[k]; sumAbs += Math.abs(c); sumSigned += c; sumTargets += g.targets[k]; }
  assert.equal(sumAbs, exp.sum_abs_counts); assert.equal(sumSigned, exp.sum_signed_counts); assert.equal(sumTargets, exp.sum_targets);
  for (const row of exp.spot_rows) {
    const a = g.offsets[row.pre], b = g.offsets[row.pre + 1];
    assert.equal(b - a, row.targets.length);
    assert.deepEqual(Array.from(g.targets.subarray(a, b)), row.targets);
    assert.deepEqual(Array.from(g.counts.subarray(a, b)), row.counts);
  }
});
