import test from 'node:test';
import assert from 'node:assert/strict';
import { SimulationEngine } from '../src/simulation/engine.js';
import { scenarios, scenarioById } from '../src/config/scenarios.js';

const scenario = scenarios[0];

const runEngine = (overrides = {}) =>
  new SimulationEngine({
    scenario,
    mode: 'adaptive',
    seed: 42,
    durationSec: 240,
    ...overrides,
  }).runToCompletion();

test('both control modes run and report measured metrics', () => {
  for (const mode of ['fixed', 'adaptive']) {
    const result = runEngine({ mode });
    const m = result.metrics;

    assert.equal(m.vehiclesSpawned > 0, true, `${mode} should spawn vehicles`);
    assert.equal(m.vehiclesCompleted > 0, true, `${mode} should complete trips`);
    assert.equal(m.vehiclesCompleted, m.throughputVehicles);
    assert.equal(m.vehiclesActiveAtEnd, m.vehiclesSpawned - m.vehiclesCompleted);
    assert.ok(m.averageWaitingTimeSec >= 0);
    assert.ok(m.averageTravelTimeSec > 0);
    assert.ok(m.maxQueueLength >= 0);
    assert.ok(m.fairnessIndex >= 0 && m.fairnessIndex <= 1);
    assert.equal(result.perIntersection.length, 4);
    assert.equal(result.perApproach.length, 16);
    assert.ok(result.timeSeries.length > 0);
  }
});

test('same seed + config is fully reproducible', () => {
  const a = runEngine({ mode: 'adaptive', seed: 7 });
  const b = runEngine({ mode: 'adaptive', seed: 7 });

  assert.deepEqual(a.metrics, b.metrics);
  assert.deepEqual(a.timeSeries, b.timeSeries);
  assert.deepEqual(a.decisions, b.decisions);
});

test('same seed produces the same demand in both modes', () => {
  const fixed = runEngine({ mode: 'fixed', seed: 99 });
  const adaptive = runEngine({ mode: 'adaptive', seed: 99 });

  // Arrival generation does not depend on the controller, so the number of
  // vehicles entering the network must match exactly.
  assert.equal(fixed.metrics.vehiclesSpawned, adaptive.metrics.vehiclesSpawned);
  assert.equal(fixed.timeSeries[5].activeVehicles >= 0, true);
});

test('signal safety invariants hold', () => {
  const result = runEngine({ mode: 'adaptive', seed: 3, durationSec: 400 });
  const minGreen = scenario.signal.minGreenSec;
  const clearance = scenario.signal.amberSec + scenario.signal.allRedSec;

  const byIntersection = new Map();
  for (const decision of result.decisions) {
    assert.notEqual(decision.fromPhaseIndex, decision.toPhaseIndex, 'must switch phases');
    assert.ok(
      decision.greenElapsedSec >= minGreen - 0.001,
      `green ${decision.greenElapsedSec}s < minGreen ${minGreen}s at ${decision.intersectionId}`
    );

    const list = byIntersection.get(decision.intersectionId) || [];
    if (list.length) {
      const previous = list[list.length - 1];
      assert.ok(
        decision.t - previous.t >= minGreen + clearance - 0.001,
        `switches too close together at ${decision.intersectionId}: ${previous.t} -> ${decision.t}`
      );
    }
    list.push(decision);
    byIntersection.set(decision.intersectionId, list);
  }
});

test('max green is respected (with bounded emergency extension)', () => {
  const result = runEngine({ mode: 'adaptive', seed: 21, durationSec: 400 });
  const limit = scenario.signal.maxGreenSec + scenario.signal.emergencyExtraGreenSec + 0.001;
  for (const decision of result.decisions) {
    assert.ok(decision.greenElapsedSec <= limit, `green ${decision.greenElapsedSec}s exceeds ${limit}s`);
  }
});

test('blocked approach receives no service and builds a queue', () => {
  const blockedScenario = scenarioById('blocked-approach');
  const result = new SimulationEngine({
    scenario: blockedScenario,
    mode: 'adaptive',
    seed: 42,
    durationSec: 300,
  }).runToCompletion();

  const blocked = result.perApproach.find((a) => a.intersectionId === 'I4' && a.side === 'W');
  assert.ok(blocked, 'blocked approach exists');
  assert.equal(blocked.blocked, true);
  assert.equal(blocked.discharged, 0);
  assert.ok(blocked.maxQueueLength > 0);
  assert.ok(blocked.arrivals > 0);
});

test('overrides can unblock a closed approach', () => {
  const blockedScenario = scenarioById('blocked-approach');
  const result = new SimulationEngine({
    scenario: blockedScenario,
    mode: 'adaptive',
    seed: 42,
    durationSec: 300,
    overrides: { clearBlocked: true },
  }).runToCompletion();

  const approach = result.perApproach.find((a) => a.intersectionId === 'I4' && a.side === 'W');
  assert.equal(approach.blocked, false);
  assert.ok(approach.discharged > 0);
});

test('emergency vehicle triggers priority control when needed', () => {
  const result = runEngine({
    mode: 'fixed',
    durationSec: 300,
    overrides: {
      emergency: {
        enabled: true,
        afterSec: 120,
        entryIntersectionId: 'I1',
        entrySide: 'N',
        destinationIntersectionId: 'I4',
      },
    },
  });

  assert.equal(result.metrics.emergencyVehiclesUsed, true);
  assert.ok(
    result.decisions.some((d) => d.reason === 'emergency_preemption'),
    'expected at least one emergency preemption'
  );
  assert.ok(result.metrics.preemptions >= 1);
});

test('recording captures replay frames', () => {
  const result = new SimulationEngine({
    scenario,
    mode: 'fixed',
    seed: 1,
    durationSec: 60,
    record: true,
    recordFrameIntervalSec: 1,
  }).runToCompletion();

  assert.ok(result.frames.length >= 50);
  const frame = result.frames[0];
  assert.ok(Array.isArray(frame.vehicles));
  assert.ok(frame.signals.I1);
  assert.ok(['green', 'amber', 'allRed'].includes(frame.signals.I1.state));
});

test('demandScale changes the arrival volume deterministically', () => {
  const base = runEngine({ mode: 'fixed', seed: 5, demandScale: 1 });
  const scaled = runEngine({ mode: 'fixed', seed: 5, demandScale: 2 });

  assert.ok(
    scaled.metrics.vehiclesSpawned > base.metrics.vehiclesSpawned * 1.5,
    'doubling demand should substantially increase arrivals'
  );
});
