import test from 'node:test';
import assert from 'node:assert/strict';
import { createRng, hashSeed } from '../src/simulation/rng.js';

test('same seed produces the same sequence', () => {
  const a = createRng(123);
  const b = createRng(123);
  const seqA = Array.from({ length: 50 }, () => a.next());
  const seqB = Array.from({ length: 50 }, () => b.next());
  assert.deepEqual(seqA, seqB);
});

test('different seeds produce different sequences', () => {
  const a = createRng(1);
  const b = createRng(2);
  const seqA = Array.from({ length: 20 }, () => a.next());
  const seqB = Array.from({ length: 20 }, () => b.next());
  assert.notDeepEqual(seqA, seqB);
});

test('outputs are uniformly distributed in [0, 1)', () => {
  const rng = createRng('raasta');
  let sum = 0;
  let below = 0;
  const n = 20000;
  for (let i = 0; i < n; i += 1) {
    const x = rng.next();
    assert.ok(x >= 0 && x < 1);
    sum += x;
    if (x < 0.25) below += 1;
  }
  assert.ok(Math.abs(sum / n - 0.5) < 0.02, 'mean should be near 0.5');
  assert.ok(Math.abs(below / n - 0.25) < 0.02, 'quartile share should be near 0.25');
});

test('string seeds hash deterministically', () => {
  assert.equal(hashSeed('karachi'), hashSeed('karachi'));
  assert.notEqual(hashSeed('karachi'), hashSeed('lahore'));
});
