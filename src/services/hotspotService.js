/**
 * Hotspot detection (Infrastructure Intelligence, PRP §9).
 *
 * Hotspots are derived from measured simulation state: persistent queues and
 * signal waits on individual approaches. A hotspot is a candidate for further
 * investigation, not a verified real-world problem.
 */

import { scenarioById } from '../config/scenarios.js';
import { clamp, round } from '../utils/misc.js';
import { ApiError } from '../utils/ApiError.js';
import { getRepos } from '../db/index.js';

export const HOTSPOT_THRESHOLDS = {
  averageQueueLength: 5, // vehicles, time-averaged on one approach
  maxQueueLength: 12,
  averageSignalWaitSec: 30,
  serviceRatio: 0.85,
  leftTurnShare: 0.25,
  approachImbalance: 1.8,
  blockedMinQueue: 3,
};

const SEVERITY_ORDER = { low: 1, medium: 2, high: 3, critical: 4 };

const PRELIMINARY_INTERVENTIONS = {
  approach_closure: ['Incident / closure management', 'Diversion or rerouting'],
  insufficient_capacity: ['Lane or road redesign', 'Turning-movement review'],
  turning_conflict: ['Turn restriction or protected turn phase', 'Lane redesign'],
  demand_imbalance: ['Demand-responsive signal timing'],
  signal_allocation: ['Signal timing optimisation'],
  general_congestion: ['Further data collection', 'Signal timing review'],
};

const mean = (values) =>
  values.length ? values.reduce((a, b) => a + b, 0) / values.length : 0;

function evidenceStrengthFor(sim, served) {
  const duration = sim.durationSec ?? 0;
  if (duration >= 900 && served >= 120) return 'high';
  if (duration >= 300 && served >= 40) return 'medium';
  return 'low';
}

function buildCauses({ blocked, serviceRatio, avgQueue, avgWait, leftShare, imbalance }) {
  const causes = [];
  // A closed approach is an incident-management problem first: green time cannot
  // restore capacity, so signal/capacity causes are not attributed to it.
  if (blocked) return ['approach_closure'];
  if (serviceRatio !== null && serviceRatio < HOTSPOT_THRESHOLDS.serviceRatio && avgQueue >= HOTSPOT_THRESHOLDS.averageQueueLength) {
    causes.push('insufficient_capacity');
  }
  if (leftShare >= HOTSPOT_THRESHOLDS.leftTurnShare && avgQueue >= 4) causes.push('turning_conflict');
  if (imbalance >= HOTSPOT_THRESHOLDS.approachImbalance && avgWait >= 20) causes.push('demand_imbalance');
  if (avgWait >= HOTSPOT_THRESHOLDS.averageSignalWaitSec || avgQueue >= HOTSPOT_THRESHOLDS.averageQueueLength) {
    causes.push('signal_allocation');
  }
  if (!causes.length) causes.push('general_congestion');
  return causes;
}

/**
 * Detect hotspots in a completed simulation document.
 */
export function detectHotspots(sim, { limit = 10, minSeverity = null } = {}) {
  if (!sim) throw ApiError.badRequest('A simulation is required to detect hotspots');

  if (!sim.metrics || sim.status !== 'completed') {
    throw ApiError.conflict(
      `Simulation '${sim.id}' has no completed metrics (status: ${sim.status}). Run it to completion first.`
    );
  }

  const scenario = scenarioById(sim.scenarioId);
  const geoById = new Map(
    (scenario?.network?.intersections ?? []).map((i) => [i.id, i])
  );

  const perApproach = sim.perApproach ?? [];
  const perIntersection = sim.perIntersection ?? [];
  const totalAverageQueue = Math.max(
    1e-6,
    perApproach.reduce((acc, a) => acc + (a.averageQueueLength ?? 0), 0)
  );

  const hotspots = [];

  for (const approach of perApproach) {
    const avgQueue = approach.averageQueueLength ?? 0;
    const maxQueue = approach.maxQueueLength ?? 0;
    const avgWait = approach.averageSignalWaitSec ?? 0;
    const maxWait = approach.maxSignalWaitSec ?? 0;
    const arrivals = approach.arrivals ?? 0;
    const discharged = approach.discharged ?? 0;
    const blocked = Boolean(approach.blocked);
    const serviceRatio = arrivals > 0 ? Math.min(1, discharged / arrivals) : null;

    const isHotspot = blocked
      ? maxQueue >= HOTSPOT_THRESHOLDS.blockedMinQueue
      : avgQueue >= HOTSPOT_THRESHOLDS.averageQueueLength ||
        avgWait >= HOTSPOT_THRESHOLDS.averageSignalWaitSec ||
        maxQueue >= HOTSPOT_THRESHOLDS.maxQueueLength;

    if (!isHotspot) continue;

    const siblings = perApproach
      .filter((a) => a.intersectionId === approach.intersectionId)
      .map((a) => a.averageQueueLength ?? 0);
    const meanSiblingQueue = mean(siblings);
    const imbalance = meanSiblingQueue > 0 ? Math.max(...siblings) / meanSiblingQueue : 1;

    const leftShare = discharged > 0 ? (approach.movements?.left ?? 0) / discharged : 0;

    const queueScore = clamp(avgQueue / 12, 0, 1);
    const waitScore = clamp(avgWait / 60, 0, 1);
    const maxQueueScore = clamp(maxQueue / 25, 0, 1);

    let score = 0.45 * queueScore + 0.35 * waitScore + 0.2 * maxQueueScore;
    if (blocked && maxQueue > 0) score = Math.max(score, 0.85);
    if (avgWait >= 60) score = Math.max(score, 0.75);

    const causes = buildCauses({ blocked, serviceRatio, avgQueue, avgWait, leftShare, imbalance });
    const severity =
      score >= 0.75 ? 'critical' : score >= 0.55 ? 'high' : score >= 0.35 ? 'medium' : 'low';

    const geo = geoById.get(approach.intersectionId);
    const intersectionStats = perIntersection.find((i) => i.id === approach.intersectionId);

    const strength = blocked ? 'high' : evidenceStrengthFor(sim, discharged);

    const indicators = [
      {
        metric: 'averageQueueLength',
        value: round(avgQueue),
        unit: 'vehicles',
        threshold: HOTSPOT_THRESHOLDS.averageQueueLength,
        exceeded: avgQueue >= HOTSPOT_THRESHOLDS.averageQueueLength,
      },
      {
        metric: 'averageSignalWaitSec',
        value: round(avgWait),
        unit: 's',
        threshold: HOTSPOT_THRESHOLDS.averageSignalWaitSec,
        exceeded: avgWait >= HOTSPOT_THRESHOLDS.averageSignalWaitSec,
      },
      {
        metric: 'maxQueueLength',
        value: round(maxQueue),
        unit: 'vehicles',
        threshold: HOTSPOT_THRESHOLDS.maxQueueLength,
        exceeded: maxQueue >= HOTSPOT_THRESHOLDS.maxQueueLength,
      },
      {
        metric: 'serviceRatio',
        value: serviceRatio === null ? null : round(serviceRatio, 2),
        unit: 'ratio',
        threshold: HOTSPOT_THRESHOLDS.serviceRatio,
        exceeded: serviceRatio !== null && serviceRatio < HOTSPOT_THRESHOLDS.serviceRatio,
      },
    ];

    hotspots.push({
      id: `hs_${sim.id}_${approach.intersectionId}_${approach.side}`,
      simulationId: sim.id,
      scenarioId: sim.scenarioId,
      intersectionId: approach.intersectionId,
      intersectionName: approach.intersectionName ?? approach.intersectionId,
      side: approach.side,
      approachName: approach.name ?? `${approach.side} approach`,
      location: geo ? { lat: geo.lat, lng: geo.lng, label: geo.name, approximate: true } : null,
      severity,
      score: round(score, 3),
      evidenceStrength: strength,
      evidence: {
        observedPeriodSec: sim.durationSec,
        controlMode: sim.mode,
        seed: sim.seed,
        averageQueueLength: round(avgQueue),
        maxQueueLength: round(maxQueue),
        averageSignalWaitSec: round(avgWait),
        maxSignalWaitSec: round(maxWait),
        arrivals,
        discharged,
        serviceRatio: serviceRatio === null ? null : round(serviceRatio, 2),
        blocked,
        lanes: approach.lanes ?? null,
        turningMovements: approach.movements ?? null,
        leftTurnShare: round(leftShare, 3),
        queueShareOfNetworkPct: round((avgQueue / totalAverageQueue) * 100, 1),
        intersectionAverageQueueLength: intersectionStats?.averageQueueLength ?? null,
        approachQueueImbalance: round(imbalance, 2),
      },
      indicators,
      likelyCauses: causes,
      preliminaryInterventions: [
        ...new Set(causes.flatMap((c) => PRELIMINARY_INTERVENTIONS[c] ?? [])),
      ],
      caveat:
        'Derived from simulated data only. Preliminary screening for further investigation; professional traffic-engineering validation required.',
    });
  }

  hotspots.sort((a, b) => b.score - a.score || SEVERITY_ORDER[b.severity] - SEVERITY_ORDER[a.severity]);

  const filtered = minSeverity
    ? hotspots.filter((h) => SEVERITY_ORDER[h.severity] >= SEVERITY_ORDER[minSeverity])
    : hotspots;

  const selected = filtered.slice(0, limit);

  // Severity counts describe every candidate found, independent of the
  // minSeverity filter applied to the returned list.
  const bySeverity = { critical: 0, high: 0, medium: 0, low: 0 };
  for (const h of hotspots) bySeverity[h.severity] += 1;

  const topIntersections = [...new Set(hotspots.map((h) => h.intersectionId))].slice(0, 5);

  return {
    simulationId: sim.id,
    scenarioId: sim.scenarioId,
    scenarioName: sim.scenarioName,
    mode: sim.mode,
    seed: sim.seed,
    durationSec: sim.durationSec,
    generatedAt: new Date().toISOString(),
    thresholds: HOTSPOT_THRESHOLDS,
    summary: {
      totalCandidates: hotspots.length,
      returned: selected.length,
      bySeverity,
      topIntersections,
      note:
        hotspots.length === 0
          ? 'No approach crossed the hotspot thresholds in this simulated run.'
          : 'Ranked by a transparent rule-based score; no machine-learning confidence is implied.',
    },
    hotspots: selected,
    caveat:
      'Hotspots are simulated screening candidates. They must not be used to justify construction or operational changes without field data and professional review.',
  };
}

export async function detectHotspotsForSimulationId(simulationId, options = {}) {
  const sim = await getRepos().simulations.findById(simulationId);
  if (!sim) throw ApiError.notFound(`Simulation '${simulationId}' was not found`);
  return detectHotspots(sim, options);
}

export function makeSyntheticHotspotFromMetrics(metrics = {}) {
  const avgQueue = metrics.averageQueueLength ?? metrics.queueLength ?? 0;
  const maxQueue = metrics.maxQueueLength ?? avgQueue;
  const avgWait = metrics.averageSignalWaitSec ?? metrics.averageWaitingTimeSec ?? 0;
  const arrived = metrics.arrivals ?? metrics.vehiclesSpawned ?? 0;
  const served = metrics.discharged ?? metrics.vehiclesCompleted ?? 0;
  const serviceRatio = arrived > 0 ? Math.min(1, served / arrived) : null;
  const blocked = Boolean(metrics.blocked);

  const causes = buildCauses({
    blocked,
    serviceRatio,
    avgQueue,
    avgWait,
    leftShare: metrics.leftTurnShare ?? 0,
    imbalance: metrics.approachQueueImbalance ?? 1,
  });

  return {
    id: metrics.hotspotId ?? 'metrics_input',
    simulationId: metrics.simulationId ?? null,
    intersectionId: metrics.intersectionId ?? 'unspecified',
    intersectionName: metrics.intersectionName ?? 'Unspecified location',
    side: metrics.side ?? null,
    approachName: metrics.approachName ?? 'Unspecified approach',
    severity: blocked ? 'critical' : avgQueue >= 12 || avgWait >= 60 ? 'high' : 'medium',
    score: round(clamp(avgQueue / 12, 0, 1) * 0.5 + clamp(avgWait / 60, 0, 1) * 0.5, 3),
    evidenceStrength: 'low',
    evidence: {
      averageQueueLength: avgQueue,
      maxQueueLength: maxQueue,
      averageSignalWaitSec: avgWait,
      arrivals: arrived,
      discharged: served,
      serviceRatio: serviceRatio === null ? null : round(serviceRatio, 2),
      blocked,
      observedPeriodSec: metrics.durationSec ?? null,
    },
    indicators: [],
    likelyCauses: causes,
    caveat:
      'Built from caller-supplied aggregate metrics. No simulation run is attached; evidence strength is low.',
  };
}

export default { detectHotspots, detectHotspotsForSimulationId, makeSyntheticHotspotFromMetrics };
