/**
 * Rule-based intervention screening (PRP §9).
 *
 * The output ranks interventions for further investigation. It never
 * prescribes construction: flyovers/underpasses require full feasibility work.
 */

import { ApiError } from '../utils/ApiError.js';
import { getRepos } from '../db/index.js';
import {
  detectHotspots,
  makeSyntheticHotspotFromMetrics,
} from './hotspotService.js';

const DISCLAIMER =
  'Preliminary simulation-based screening only. Not an engineering recommendation, approval or construction justification. ' +
  'Field data, site inspection and professional traffic-engineering validation are required.';

const evidenceText = (hotspot) => {
  const e = hotspot.evidence || {};
  const lines = [];
  if (e.averageQueueLength !== undefined)
    lines.push(`Average queue length: ${e.averageQueueLength} vehicles`);
  if (e.maxQueueLength !== undefined) lines.push(`Maximum queue length: ${e.maxQueueLength} vehicles`);
  if (e.averageSignalWaitSec !== undefined)
    lines.push(`Average signal wait: ${e.averageSignalWaitSec}s`);
  if (e.arrivals !== undefined) lines.push(`Approach arrivals: ${e.arrivals}`);
  if (e.discharged !== undefined) lines.push(`Vehicles discharged: ${e.discharged}`);
  if (e.serviceRatio !== undefined && e.serviceRatio !== null)
    lines.push(`Service ratio (discharged/arrivals): ${e.serviceRatio}`);
  if (e.leftTurnShare !== undefined) lines.push(`Left-turn share: ${(e.leftTurnShare * 100).toFixed(0)}%`);
  if (e.observedPeriodSec) lines.push(`Observed simulation period: ${e.observedPeriodSec}s`);
  return lines;
};

/**
 * Evaluate a single hotspot against the documented intervention rules.
 */
export function evaluateHotspot(hotspot) {
  if (!hotspot || typeof hotspot !== 'object') {
    throw ApiError.badRequest('A hotspot object is required');
  }

  const evidence = hotspot.evidence || {};
  const causes = Array.isArray(hotspot.likelyCauses) ? hotspot.likelyCauses : [];
  const lines = evidenceText(hotspot);
  const interventions = [];
  const add = (obj) => interventions.push(obj);

  const isBlocked = Boolean(evidence.blocked) || causes.includes('approach_closure');

  if (isBlocked) {
    add({
      type: 'incident_management',
      title: 'Manage or remove the closure, then re-measure',
      rationale:
        'This approach is closed in the scenario, so no control strategy can discharge the queue. Signal timing cannot restore capacity that does not exist.',
      supportingEvidence: lines,
      confidence: 'high',
      studyRequired: false,
      canSignalTimingSolve: false,
      nextSteps: [
        'Confirm the closure or incident with field observation.',
        'Implement diversion or rerouting while the approach is closed.',
        'Re-run the scenario with the approach reopened before judging signal performance.',
      ],
    });
  }

  if (causes.includes('signal_allocation') || causes.includes('demand_imbalance')) {
    add({
      type: 'signal_optimization',
      title: 'Re-allocate green time / use demand-responsive control',
      rationale:
        'Measured queues and signal waits indicate that available green time is not aligned with the demand on this approach. This is the lowest-cost operational option and should be tested first where it applies.',
      supportingEvidence: lines,
      confidence: hotspot.evidenceStrength === 'high' ? 'medium' : 'low',
      studyRequired: false,
      canSignalTimingSolve: true,
      nextSteps: [
        'Validate arrival counts and turning movements for this approach.',
        'Run paired fixed-vs-adaptive comparisons in the Performance Lab.',
        'Trial any revised timing plan under supervision and monitor field results.',
      ],
    });
  }

  if (causes.includes('turning_conflict')) {
    add({
      type: 'turn_restriction',
      title: 'Review turning movements (restriction or protected phase)',
      rationale:
        'A large share of the approach volume turns, and queues persist. A turn restriction or protected turn phase may reduce conflict and blocking, but access and safety impacts must be assessed.',
      supportingEvidence: lines,
      confidence: 'low',
      studyRequired: true,
      canSignalTimingSolve: false,
      nextSteps: [
        'Collect turning-movement counts at the intersection.',
        'Assess access, safety and rerouting consequences of any restriction.',
        'Model the restriction as a counterfactual scenario before proposing it.',
      ],
    });
    add({
      type: 'lane_or_road_redesign',
      title: 'Study lane allocation / approach redesign',
      rationale:
        'Turning conflicts combined with persistent queues can indicate an approach-capacity or lane-allocation problem that signal timing alone will not resolve.',
      supportingEvidence: lines,
      confidence: 'low',
      studyRequired: true,
      canSignalTimingSolve: false,
      nextSteps: [
        'Survey approach geometry, lane use and turning paths.',
        'Test a hypothetical lane configuration as a counterfactual scenario.',
      ],
    });
  } else if (causes.includes('insufficient_capacity')) {
    add({
      type: 'lane_or_road_redesign',
      title: 'Investigate lane or road redesign',
      rationale:
        'The approach serves consistently less traffic than arrives, and queues persist. This suggests a capacity limitation that is not resolved by control alone, pending measured field data.',
      supportingEvidence: lines,
      confidence: hotspot.evidenceStrength === 'high' ? 'medium' : 'low',
      studyRequired: true,
      canSignalTimingSolve: false,
      nextSteps: [
        'Collect official or manually observed traffic counts for this approach.',
        'Assess lane use, parking, encroachment and turning conflicts.',
        'Test a hypothetical capacity change as a counterfactual scenario.',
      ],
    });
  }

  const severe = (hotspot.score ?? 0) >= 0.65;
  const longRun = (evidence.observedPeriodSec ?? 0) >= 600;

  if ((causes.includes('insufficient_capacity') || causes.includes('turning_conflict')) && severe && longRun) {
    add({
      type: 'grade_separation_study',
      title: 'Commission a grade-separation feasibility study',
      rationale:
        'Severe, persistent queues survived the tested operational options in this simulation. This flags the location for a separate feasibility study. It is not a recommendation to build a flyover or underpass.',
      supportingEvidence: lines,
      confidence: 'low',
      studyRequired: true,
      canSignalTimingSolve: false,
      nextSteps: [
        'Collect classified traffic counts, origin–destination data and peak profiles.',
        'Assess geometry, access, safety, environmental, cost and feasibility impacts.',
        'Compare alternatives through a formal transport-engineering study.',
      ],
    });
  }

  if (!interventions.length) {
    add({
      type: 'signal_optimization',
      title: 'Review signal timings and collect more evidence',
      rationale:
        'The approach shows congestion indicators but no single dominant cause. Further observation and timing review are the appropriate first steps.',
      supportingEvidence: lines,
      confidence: 'low',
      studyRequired: false,
      canSignalTimingSolve: true,
      nextSteps: ['Collect field data', 'Run longer or multi-seed simulations', 'Review the signal plan'],
    });
  }

  const hasGradeSeparation = interventions.some((i) => i.type === 'grade_separation_study');

  return {
    hotspotId: hotspot.id ?? null,
    simulationId: hotspot.simulationId ?? null,
    intersectionId: hotspot.intersectionId ?? null,
    intersectionName: hotspot.intersectionName ?? null,
    side: hotspot.side ?? null,
    approachName: hotspot.approachName ?? null,
    severity: hotspot.severity ?? null,
    score: hotspot.score ?? null,
    evidenceStrength: hotspot.evidenceStrength ?? 'low',
    evidence: hotspot.evidence ?? {},
    likelyCauses: causes,
    interventions,
    caveats: [
      'Simulated output with synthetic demand and documented assumptions; real-world volumes and signal settings are not represented.',
      'A hotspot flag is a screening signal, not a verified defect.',
      'Any operational change requires site inspection and professional traffic-engineering review.',
      ...(hasGradeSeparation
        ? [
            'A flyover or underpass is a major infrastructure decision requiring traffic counts, origin–destination analysis, geometry, safety, access, environmental, cost and feasibility studies. This prototype does not approve or imply one.',
          ]
        : []),
    ],
    disclaimer: DISCLAIMER,
  };
}

export async function evaluateSimulationHotspots(simulationId) {
  const sim = await getRepos().simulations.findById(simulationId);
  if (!sim) throw ApiError.notFound(`Simulation '${simulationId}' was not found`);

  const detection = detectHotspots(sim, { limit: 20 });
  const evaluations = detection.hotspots.map(evaluateHotspot);

  return {
    simulationId: sim.id,
    scenarioId: sim.scenarioId,
    scenarioName: sim.scenarioName,
    mode: sim.mode,
    seed: sim.seed,
    generatedAt: new Date().toISOString(),
    summary: {
      hotspotsEvaluated: evaluations.length,
      bySeverity: detection.summary.bySeverity,
      highestSeverity: detection.hotspots[0]?.severity ?? null,
      note:
        evaluations.length === 0
          ? 'No hotspot crossed the thresholds, so no intervention screening was produced.'
          : 'Interventions are ranked for further investigation; they are not approvals.',
    },
    evaluations,
    caveat: DISCLAIMER,
  };
}

/**
 * Accepts { simulationId } | { hotspot } | { metrics } from the API layer.
 */
export async function evaluateRecommendationsRequest(payload) {
  if (payload.simulationId) {
    return evaluateSimulationHotspots(payload.simulationId);
  }

  if (payload.hotspot) {
    const evaluation = evaluateHotspot(payload.hotspot);
    return {
      summary: { hotspotsEvaluated: 1, note: 'Evaluated the supplied hotspot object.' },
      evaluations: [evaluation],
      caveat: DISCLAIMER,
    };
  }

  if (payload.metrics) {
    const hotspot = makeSyntheticHotspotFromMetrics(payload.metrics);
    const evaluation = evaluateHotspot(hotspot);
    return {
      summary: {
        hotspotsEvaluated: 1,
        note: 'Evaluated caller-supplied aggregate metrics; evidence strength is low by construction.',
      },
      evaluations: [evaluation],
      caveat: DISCLAIMER,
    };
  }

  throw ApiError.badRequest('Provide simulationId, hotspot or metrics');
}

export default {
  evaluateHotspot,
  evaluateSimulationHotspots,
  evaluateRecommendationsRequest,
};
