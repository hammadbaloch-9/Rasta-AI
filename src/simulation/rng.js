/**
 * Deterministic, seedable PRNG (mulberry32).
 * The same seed and the same call order always produce the same sequence,
 * which is what makes fixed-vs-adaptive comparisons fair and reproducible.
 */

export function hashSeed(seed) {
  const str = String(seed);
  let h = 2166136261 >>> 0; // FNV-1a
  for (let i = 0; i < str.length; i += 1) {
    h ^= str.charCodeAt(i);
    h = Math.imul(h, 16777619);
  }
  return h >>> 0;
}

export function createRng(seed) {
  let a = hashSeed(seed) || 1;

  const next = () => {
    a |= 0;
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };

  const api = {
    seed,
    next,
    /** float in [min, max) */
    range: (min, max) => min + next() * (max - min),
    /** integer in [0, maxExclusive) */
    int: (maxExclusive) => Math.floor(next() * maxExclusive),
    /** true with probability p */
    chance: (p) => next() < p,
    pick: (arr) => arr[Math.floor(next() * arr.length)],
    /** Poisson sample via Knuth (small lambda only) */
    poisson(lambda) {
      if (lambda <= 0) return 0;
      if (lambda > 30) {
        // normal approximation for large lambda
        const u1 = Math.max(next(), 1e-12);
        const u2 = next();
        const z = Math.sqrt(-2 * Math.log(u1)) * Math.cos(2 * Math.PI * u2);
        return Math.max(0, Math.round(lambda + Math.sqrt(lambda) * z));
      }
      const L = Math.exp(-lambda);
      let k = 0;
      let p = 1;
      do {
        k += 1;
        p *= next();
      } while (p > L);
      return k - 1;
    },
  };

  return api;
}

export default createRng;
