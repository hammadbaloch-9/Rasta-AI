let counter = 0;

/** Short, sortable, unique id (no external dependency needed). */
export function newId(prefix = 'sim') {
  counter = (counter + 1) % 0xffffff;
  const time = Date.now().toString(36);
  const rand = Math.random().toString(36).slice(2, 8);
  const seq = counter.toString(36).padStart(4, '0');
  return `${prefix}_${time}${seq}${rand}`;
}

export const nowIso = () => new Date().toISOString();

export const round = (value, decimals = 2) => {
  if (!Number.isFinite(value)) return null;
  const f = 10 ** decimals;
  return Math.round(value * f) / f;
};

/** Percentage change with explicit zero-denominator handling. */
export function percentChange(from, to) {
  if (!Number.isFinite(from) || !Number.isFinite(to)) {
    return { value: null, note: 'not computable (non-numeric input)' };
  }
  if (from === 0) {
    return { value: null, note: 'not computable (baseline value is zero)' };
  }
  return { value: round(((to - from) / from) * 100, 2), note: null };
}

/** Clamp helper. */
export const clamp = (value, min, max) => Math.min(max, Math.max(min, value));
