import test from 'node:test';
import assert from 'node:assert/strict';
import { SimulationEngine } from '../src/simulation/engine.js';
import { scenarioById } from '../src/config/scenarios.js';
import { detectHotspots } from '../src/services/hotspotService.js';
import {
  evaluateHotspot,
  evaluateRecommendationsRequest,
} from '../src/services/recommendationService.js';

const runToSimDoc = (scenarioId, mode = 'fixed', seed = 42, durationSec = 600) => {
  const scenario = scenarioById(scenarioId);
  const result = new SimulationEngine({ scenario, mode, seed, durationSec }).runToCompletion();
  return {
    id: `test_${scenarioId}_${mode}`,
    scenarioId: scenario.id,
    scenarioName: scenario.name,
    status: 'completed',
    mode,
    seed,
    durationSec,
    metrics: result.metrics,
    perApproach: result.perApproach,
    perIntersection: result.perIntersection,
  };
};

test('blocked approach becomes a critical closure hotspot with incident guidance', () => {
  const sim = runToSimDoc('blocked-approach');
  const detection = detectHotspots(sim);

  assert.ok(detection.hotspots.length >= 1);
  const blocked = detection.hotspots.find((h) => h.intersectionId === 'I4' && h.side === 'W');
  assert.ok(blocked, 'blocked approach is flagged');
  assert.equal(blocked.severity, 'critical');
  assert.deepEqual(blocked.likelyCauses, ['approach_closure']);
  assert.equal(blocked.evidence.blocked, true);
  assert.equal(blocked.evidence.discharged, 0);

  const evaluation = evaluateHotspot(blocked);
  const types = evaluation.interventions.map((i) => i.type);
  assert.ok(types.includes('incident_management'));
  assert.ok(!types.includes('grade_separation_study'), 'closure must not trigger a flyover study');
  assert.equal(evaluation.interventions[0].canSignalTimingSolve, false);
  assert.ok(evaluation.caveats.length >= 2);
  assert.match(evaluation.disclaimer, /professional/i);
});

test('congested fixed-time run produces actionable signal hotspots', () => {
  const sim = runToSimDoc('saddar-balanced');
  const detection = detectHotspots(sim);

  assert.ok(detection.hotspots.length > 0, 'expected hotspot candidates');

  const withSignal = detection.hotspots
    .map(evaluateHotspot)
    .filter((e) => e.interventions.some((i) => i.type === 'signal_optimization'));

  assert.ok(withSignal.length > 0, 'expected at least one signal-optimisation candidate');
  for (const evaluation of withSignal) {
    assert.ok(['low', 'medium', 'high'].includes(evaluation.evidenceStrength));
    assert.ok(evaluation.caveats.some((c) => /simulat/i.test(c)));
  }
});

test('hotspot detection refuses runs without completed metrics', () => {
  assert.throws(
    () => detectHotspots({ id: 'x', status: 'running', metrics: null }),
    /no completed metrics/i
  );
});

test('recommendations can evaluate raw metrics', async () => {
  const result = await evaluateRecommendationsRequest({
    metrics: {
      averageQueueLength: 14,
      maxQueueLength: 26,
      averageSignalWaitSec: 75,
      arrivals: 400,
      discharged: 300,
      leftTurnShare: 0.05,
      durationSec: 600,
    },
  });

  assert.equal(result.evaluations.length, 1);
  const evaluation = result.evaluations[0];
  const types = evaluation.interventions.map((i) => i.type);
  assert.ok(types.includes('signal_optimization'));
  assert.ok(types.includes('lane_or_road_redesign'));
  assert.equal(evaluation.evidenceStrength, 'low');
});

test('rejects an empty recommendation request', async () => {
  await assert.rejects(() => evaluateRecommendationsRequest({}), /Provide simulationId/);
});

test('every hotspot carries evidence and a professional-validation caveat', () => {
  const sim = runToSimDoc('shahrah-faisal-ns-surge');
  const detection = detectHotspots(sim);
  for (const hotspot of detection.hotspots) {
    assert.ok(hotspot.evidence);
    assert.ok(hotspot.indicators.length > 0);
    assert.ok(hotspot.caveat);
    assert.ok(['low', 'medium', 'high'].includes(hotspot.evidenceStrength));
  }
  assert.match(detection.caveat, /must not be used to justify construction/i);
});
