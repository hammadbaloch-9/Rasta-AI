/**
 * Metric aggregation, fairness and comparison helpers.
 *
 * Definitions used consistently across every run (documented in docs/API.md):
 *  - Average waiting time: total time vehicles spent below 0.5 m/s divided by
 *    the number of vehicles that entered the network (spawned). This definition
 *    is identical for fixed and adaptive runs with the same seed, because the
 *    arrival stream is independent of the controller.
 *  - Average travel time: mean elapsed time for vehicles that exited the network.
 *  - Maximum queue length: the largest simultaneous total of stopped/queued
 *    vehicles on any approach at any tick.
 *  - Throughput: vehicles that completed their trip and left the network.
 */

import { round } from '../utils/misc.js';

/** Jain's fairness index: 1 = perfectly equal, 1/n = maximally unequal. */
export function jainsFairness(values) {
  const xs = values.filter((v) => Number.isFinite(v) && v >= 0);
  if (!xs.length) return null;
  const sum = xs.reduce((a, b) => a + b, 0);
  const sumSq = xs.reduce((a, b) => a + b * b, 0);
  if (sumSq === 0) return 1;
  return (sum * sum) / (xs.length * sumSq);
}

/**
 * Compare fixed vs adaptive metrics.
 * improvementPct is always "positive = adaptive is better", following:
 *   lower-is-better : (fixed - adaptive) / fixed * 100
 *   higher-is-better: (adaptive - fixed) / fixed * 100
 * Zero denominators are reported explicitly instead of producing Infinity.
 */
export const COMPARISON_METRICS = [
  {
    key: 'averageWaitingTimeSec',
    label: 'Average waiting time',
    unit: 's',
    direction: 'lower',
  },
  {
    key: 'averageTravelTimeSec',
    label: 'Average travel time (completed trips)',
    unit: 's',
    direction: 'lower',
  },
  {
    key: 'maxQueueLength',
    label: 'Maximum queue length',
    unit: 'vehicles',
    direction: 'lower',
  },
  {
    key: 'averageQueueLength',
    label: 'Average queue length',
    unit: 'vehicles',
    direction: 'lower',
  },
  {
    key: 'averageStoppedVehicles',
    label: 'Average stopped vehicles',
    unit: 'vehicles',
    direction: 'lower',
  },
  {
    key: 'throughputVehicles',
    label: 'Throughput (completed trips)',
    unit: 'vehicles',
    direction: 'higher',
  },
  {
    key: 'throughputVehPerHour',
    label: 'Throughput rate',
    unit: 'veh/h',
    direction: 'higher',
  },
  {
    key: 'completionRatePct',
    label: 'Trip completion rate',
    unit: '%',
    direction: 'higher',
  },
  {
    key: 'fairnessIndex',
    label: 'Fairness index (Jain)',
    unit: '',
    direction: 'higher',
  },
  {
    key: 'phaseSwitches',
    label: 'Signal phase switches',
    unit: 'switches',
    direction: 'lower',
    informational: true,
  },
];

export function compareMetrics(fixed, adaptive, { seeds } = {}) {
  const rows = COMPARISON_METRICS.map((spec) => {
    const f = fixed?.[spec.key];
    const a = adaptive?.[spec.key];

    let improvementPct = null;
    let note = null;
    let better = null;

    if (!Number.isFinite(f) || !Number.isFinite(a)) {
      note = 'not computable (missing metric)';
    } else if (f === 0) {
      if (a === 0) {
        improvementPct = 0;
        better = 'equal';
        note = 'both runs report zero';
      } else {
        note = 'not computable (baseline value is zero)';
      }
    } else {
      improvementPct =
        spec.direction === 'lower'
          ? round(((f - a) / f) * 100, 2)
          : round(((a - f) / f) * 100, 2);

      if (improvementPct > 0.5) better = 'adaptive';
      else if (improvementPct < -0.5) better = 'fixed';
      else better = 'equal';
    }

    return {
      key: spec.key,
      label: spec.label,
      unit: spec.unit,
      direction: spec.direction,
      informational: Boolean(spec.informational),
      fixed: round(f),
      adaptive: round(a),
      improvementPct,
      better,
      note,
    };
  });

  const decisive = rows.filter((r) => !r.informational && r.better !== null && r.better !== 'equal');
  const adaptiveWins = decisive.filter((r) => r.better === 'adaptive').length;
  const fixedWins = decisive.filter((r) => r.better === 'fixed').length;

  const keyFindings = [];
  const wait = rows.find((r) => r.key === 'averageWaitingTimeSec');
  const queue = rows.find((r) => r.key === 'maxQueueLength');
  const throughput = rows.find((r) => r.key === 'throughputVehicles');
  const fairness = rows.find((r) => r.key === 'fairnessIndex');

  if (wait?.improvementPct !== null) {
    keyFindings.push(
      `Average waiting time: ${wait.fixed}s → ${wait.adaptive}s (${
        wait.improvementPct > 0 ? 'improved' : wait.improvementPct < 0 ? 'worsened' : 'unchanged'
      } by ${Math.abs(wait.improvementPct)}%).`
    );
  }
  if (queue?.improvementPct !== null) {
    keyFindings.push(
      `Maximum queue: ${queue.fixed} → ${queue.adaptive} vehicles (${
        queue.improvementPct > 0 ? 'improved' : queue.improvementPct < 0 ? 'worsened' : 'unchanged'
      } by ${Math.abs(queue.improvementPct)}%).`
    );
  }
  if (throughput?.improvementPct !== null) {
    keyFindings.push(
      `Throughput: ${throughput.fixed} → ${throughput.adaptive} completed trips (${
        throughput.improvementPct > 0
          ? 'improved'
          : throughput.improvementPct < 0
            ? 'worsened'
            : 'unchanged'
      } by ${Math.abs(throughput.improvementPct)}%).`
    );
  }
  if (fairness?.fixed !== null && fairness?.adaptive !== null) {
    keyFindings.push(
      `Fairness (Jain): ${fairness.fixed} vs ${fairness.adaptive} (1.0 = perfectly equal service).`
    );
  }

  const verdict =
    adaptiveWins > fixedWins
      ? 'adaptive_better_on_balance'
      : fixedWins > adaptiveWins
        ? 'fixed_better_on_balance'
        : 'mixed_or_inconclusive';

  const explanation =
    verdict === 'adaptive_better_on_balance'
      ? 'Adaptive control improved more decisive metrics than it worsened in this simulated comparison.'
      : verdict === 'fixed_better_on_balance'
        ? 'Fixed-time control performed better on more decisive metrics in this simulated comparison.'
        : 'The comparison is mixed or inconclusive; inspect individual metrics before drawing conclusions.';

  return {
    rows,
    summary: {
      verdict,
      explanation,
      adaptiveWins,
      fixedWins,
      decisiveMetrics: decisive.length,
      seeds: seeds || null,
      caveat:
        'Simulated comparison with synthetic demand. Results depend on scenario assumptions and seed; they are not a traffic-engineering validation.',
      keyFindings,
    },
  };
}

/** Aggregate per-seed runs into mean / std / min / max for a metric set. */
export function aggregateRuns(runs, metricKeys) {
  if (!runs.length) return null;
  const out = { count: runs.length };
  for (const key of metricKeys) {
    const values = runs.map((r) => r.metrics?.[key]).filter((v) => Number.isFinite(v));
    if (!values.length) {
      out[key] = null;
      continue;
    }
    const mean = values.reduce((a, b) => a + b, 0) / values.length;
    const variance =
      values.length > 1
        ? values.reduce((a, b) => a + (b - mean) ** 2, 0) / (values.length - 1)
        : 0;
    out[key] = {
      mean: round(mean),
      stdDev: round(Math.sqrt(variance)),
      min: round(Math.min(...values)),
      max: round(Math.max(...values)),
    };
  }
  return out;
}

/** Convert a run into the flat metric object used for aggregation. */
export const AGGREGATED_METRIC_KEYS = COMPARISON_METRICS.map((m) => m.key);
