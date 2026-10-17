import test from 'node:test';
import assert from 'node:assert/strict';
import { jainsFairness, compareMetrics, aggregateRuns } from '../src/simulation/metrics.js';

test('Jain fairness index is 1 for equal values', () => {
  assert.equal(jainsFairness([10, 10, 10, 10]), 1);
});

test('Jain fairness index drops for unequal values', () => {
  const fair = jainsFairness([10, 10, 10, 10]);
  const unfair = jainsFairness([20, 5, 1, 0]);
  assert.ok(unfair < fair);
  assert.ok(unfair > 0);
});

test('Jain fairness handles empty and zero inputs', () => {
  assert.equal(jainsFairness([]), null);
  assert.equal(jainsFairness([0, 0, 0]), 1);
});

test('lower-is-better metrics compute improvement as fixed minus adaptive', () => {
  const result = compareMetrics(
    { averageWaitingTimeSec: 40, throughputVehicles: 100 },
    { averageWaitingTimeSec: 30, throughputVehicles: 120 }
  );
  const wait = result.rows.find((r) => r.key === 'averageWaitingTimeSec');
  assert.equal(wait.improvementPct, 25);
  assert.equal(wait.better, 'adaptive');

  const throughput = result.rows.find((r) => r.key === 'throughputVehicles');
  assert.equal(throughput.improvementPct, 20);
  assert.equal(throughput.better, 'adaptive');
});

test('higher-is-better metrics reverse the comparison', () => {
  const result = compareMetrics(
    { throughputVehicles: 120 },
    { throughputVehicles: 100 }
  );
  const row = result.rows.find((r) => r.key === 'throughputVehicles');
  assert.ok(row.improvementPct < 0);
  assert.equal(row.better, 'fixed');
});

test('zero denominators are reported explicitly instead of Infinity', () => {
  const result = compareMetrics(
    { averageWaitingTimeSec: 0, throughputVehicles: 0 },
    { averageWaitingTimeSec: 0, throughputVehicles: 10 }
  );
  const wait = result.rows.find((r) => r.key === 'averageWaitingTimeSec');
  assert.equal(wait.improvementPct, 0);
  assert.equal(wait.note, 'both runs report zero');

  const throughput = result.rows.find((r) => r.key === 'throughputVehicles');
  assert.equal(throughput.improvementPct, null);
  assert.match(throughput.note, /baseline value is zero/);
});

test('missing metrics do not throw', () => {
  const result = compareMetrics({}, {});
  assert.equal(result.rows.length > 0, true);
  assert.equal(result.rows[0].improvementPct, null);
});

test('aggregateRuns computes mean, standard deviation and range', () => {
  const runs = [
    { metrics: { averageWaitingTimeSec: 10 } },
    { metrics: { averageWaitingTimeSec: 20 } },
    { metrics: { averageWaitingTimeSec: 30 } },
  ];
  const agg = aggregateRuns(runs, ['averageWaitingTimeSec']);
  assert.equal(agg.count, 3);
  assert.equal(agg.averageWaitingTimeSec.mean, 20);
  assert.equal(agg.averageWaitingTimeSec.min, 10);
  assert.equal(agg.averageWaitingTimeSec.max, 30);
  assert.equal(agg.averageWaitingTimeSec.stdDev, 10);
});
