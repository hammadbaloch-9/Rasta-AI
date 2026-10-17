import { asyncHandler } from '../utils/asyncHandler.js';
import { getRepos } from '../db/index.js';
import { scenarioById } from '../config/scenarios.js';
import { detectHotspots } from '../services/hotspotService.js';
import { summarizeSimulation } from '../services/simulationService.js';

/**
 * Derived congestion indicator for the Command Center.
 * This is a prototype heuristic on simulated network-wide queueing, not an
 * official traffic index.
 */
function congestionLevel(metrics) {
  const queue = metrics.averageQueueLength ?? 0;
  const wait = metrics.averageWaitingTimeSec ?? 0;
  if (queue >= 40 || wait >= 60) return 'severe';
  if (queue >= 25 || wait >= 40) return 'high';
  if (queue >= 12 || wait >= 20) return 'medium';
  return 'low';
}

/**
 * GET /api/dashboard
 * One call for the Command Center: active scenario, latest run KPIs, congestion
 * alerts, recent runs and recent experiments.
 */
export const getDashboard = asyncHandler(async (_req, res) => {
  const simulationRepo = getRepos().simulations;
  const experimentRepo = getRepos().experiments;

  const [completedList, recentList, experimentList] = await Promise.all([
    simulationRepo.list({ filter: { status: 'completed' }, limit: 1, offset: 0 }),
    simulationRepo.list({ limit: 5, offset: 0 }),
    experimentRepo.list({ limit: 3, offset: 0 }),
  ]);

  const latest = completedList.items[0] || null;
  const scenario = latest ? scenarioById(latest.scenarioId) : null;

  let alerts = [];
  let alertSummary = null;
  if (latest?.metrics) {
    const detection = detectHotspots(latest, { limit: 3, minSeverity: 'medium' });
    alerts = detection.hotspots;
    alertSummary = detection.summary;
  }

  const metrics = latest?.metrics;

  res.json({
    data: {
      generatedAt: new Date().toISOString(),
      activeScenario: scenario
        ? {
            id: scenario.id,
            name: scenario.name,
            city: scenario.city,
            disclaimer: scenario.disclaimer,
            mapContext: scenario.mapContext,
          }
        : null,
      latestSimulation: latest ? summarizeSimulation(latest) : null,
      kpis: metrics
        ? {
            scenarioId: latest.scenarioId,
            controlMode: latest.mode,
            seed: latest.seed,
            durationSec: latest.durationSec,
            vehiclesSpawned: metrics.vehiclesSpawned,
            vehiclesCompleted: metrics.vehiclesCompleted,
            vehiclesActiveAtEnd: metrics.vehiclesActiveAtEnd,
            averageWaitingTimeSec: metrics.averageWaitingTimeSec,
            maxQueueLength: metrics.maxQueueLength,
            averageQueueLength: metrics.averageQueueLength,
            throughputVehPerHour: metrics.throughputVehPerHour,
            completionRatePct: metrics.completionRatePct,
            fairnessIndex: metrics.fairnessIndex,
            congestionLevel: congestionLevel(metrics),
          }
        : null,
      alerts,
      alertSummary,
      recentRuns: recentList.items.map((doc) => summarizeSimulation(doc)),
      recentExperiments: experimentList.items.map((exp) => ({
        id: exp.id,
        label: exp.label ?? null,
        scenarioId: exp.scenarioId,
        scenarioName: exp.scenarioName,
        seeds: exp.seeds,
        createdAt: exp.createdAt,
        verdict: exp.comparison?.summary?.verdict ?? null,
        keyFindings: exp.comparison?.summary?.keyFindings ?? [],
      })),
      note:
        'Command Center aggregates the latest completed simulation. All values are simulated; the congestion level is a prototype heuristic on network queueing.',
    },
    meta: { congestionThresholds: { medium: 12, high: 25, severe: 40, unit: 'vehicles (average network queue)' } },
  });
});

export default getDashboard;
