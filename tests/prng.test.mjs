import test from 'node:test';
import assert from 'node:assert/strict';
import { Sfc32 } from '../site/engine/prng.js';

test('sfc32 is deterministic for a seed', () => {
  const a = new Sfc32(42), b = new Sfc32(42), c = new Sfc32(43);
  const xs = Array.from({ length: 20 }, () => a.nextU32()), ys = Array.from({ length: 20 }, () => b.nextU32()), zs = Array.from({ length: 20 }, () => c.nextU32());
  assert.deepEqual(xs, ys); assert.notDeepEqual(xs, zs);
});

test('sfc32 uniform: mean, variance and 32-bin chi-square are sane', () => {
  const r = new Sfc32(1234), n = 2_000_000, bins = new Array(32).fill(0);
  let s = 0, s2 = 0;
  for (let i = 0; i < n; i++) { const u = r.nextU32() / 4294967296; s += u; s2 += u * u; bins[Math.floor(u * 32)]++; }
  const mean = s / n, variance = s2 / n - mean * mean;
  assert.ok(Math.abs(mean - 0.5) < 0.002, `mean ${mean}`);
  assert.ok(Math.abs(variance - 1 / 12) < 0.001, `variance ${variance}`);
  const exp = n / 32; const chi2 = bins.reduce((a, b) => a + (b - exp) ** 2 / exp, 0);
  assert.ok(chi2 < 61.1, `chi2(31 dof) ${chi2.toFixed(1)} should be below the 0.9995 quantile 61.1`);
});

test('bernoulli threshold matches p to 2^-32', () => {
  const r = new Sfc32(9), p = 0.015, thr = Sfc32.threshold(p), n = 4_000_000;
  let k = 0; for (let i = 0; i < n; i++) if (r.nextU32() < thr) k++;
  const sd = Math.sqrt(n * p * (1 - p));
  assert.ok(Math.abs(k - n * p) < 5 * sd, `k=${k}, expected ${n * p} +- ${5 * sd}`);
});
