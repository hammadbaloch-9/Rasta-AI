import { SimulationEngine } from '../simulation/engine.js';
import { scenarioById } from '../config/scenarios.js';
import { env } from '../config/env.js';
import { getRepos } from '../db/index.js';
import { ApiError } from '../utils/ApiError.js';
import { logger } from '../utils/logger.js';
import { ENGINE_NAME, ENGINE_VERSION } from '../simulation/version.js';
import { nowIso } from '../utils/misc.js';

/** In-process registry of live (streamed) simulations. */
const liveRuns = new Map();

const RUN_SUMMARY_METRIC_KEYS = [
  'averageWaitingTimeSec',
  'averageTravelTimeSec',
  'maxQueueLength',
  'averageQueueLength',
  'averageStoppedVehicles',
  'throughputVehicles',
  'throughputVehPerHour',
  'completionRatePct',
  'fairnessIndex',
  'phaseSwitches',
  'vehiclesSpawned',
  'vehiclesCompleted',
];

export function summarizeSimulation(doc, { includeMetrics = true } = {}) {
  if (!doc) return null;
  const summary = {
    id: doc.id,
    label: doc.label ?? null,
    scenarioId: doc.scenarioId,
    scenarioName: doc.scenarioName,
    mode: doc.mode,
    seed: doc.seed,
    durationSec: doc.durationSec,
    demandScale: doc.demandScale,
    status: doc.status,
    live: Boolean(doc.live),
    experimentId: doc.experimentId ?? null,
    createdAt: doc.createdAt ?? null,
    completedAt: doc.completedAt ?? null,
    runtimeMs: doc.runtimeMs ?? null,
    error: doc.error ?? null,
  };

  if (includeMetrics && doc.metrics) {
    summary.metrics = Object.fromEntries(
      RUN_SUMMARY_METRIC_KEYS.filter((key) => doc.metrics[key] !== undefined).map((key) => [
        key,
        doc.metrics[key],
      ])
    );
  }

  return summary;
}

export function buildRunPlan(payload) {
  const scenario = scenarioById(payload.scenarioId);
  if (!scenario) {
    throw ApiError.notFound(
      `Unknown scenario '${payload.scenarioId}'. Use GET /api/scenarios to list available scenarios.`
    );
  }

  const durationSec = payload.durationSec ?? scenario.defaults.durationSec;
  const seed = payload.seed ?? scenario.defaults.seed;
  const demandScale =
    payload.demandScale ?? payload.overrides?.demandScale ?? scenario.defaults.demandScale ?? 1;
  const overrides = payload.overrides || {};

  const engine = new SimulationEngine({
    scenario,
    mode: payload.mode,
    seed,
    durationSec,
    demandScale,
    overrides,
    tickSec: env.simulation.tickSec,
    sampleIntervalSec: env.simulation.sampleIntervalSec,
    decisionLogLimit: env.simulation.decisionLogLimit,
    record: Boolean(payload.record),
    recordFrameIntervalSec: payload.recordFrameIntervalSec ?? env.simulation.recordFrameIntervalSec,
    maxRecordedFrames: env.simulation.maxRecordedFrames,
    maxFrameVehicleEntries: env.simulation.maxFrameVehicleEntries,
    maxVehicles: env.simulation.maxVehiclesHardCap,
  });

  const assumptions = [
    ...(scenario.demand?.assumptions || []),
    ...(scenario.blockedApproaches || []).map(
      (b) => `Closed approach: ${b.intersectionId} ${b.approach} — ${b.reason}`
    ),
    'All values are simulated. No live Karachi traffic feed is connected.',
  ];

  const baseDoc = {
    label: payload.label ?? null,
    scenarioId: scenario.id,
    scenarioName: scenario.name,
    mode: payload.mode,
    seed,
    durationSec,
    demandScale,
    overrides,
    status: 'running',
    live: Boolean(payload.live),
    engine: {
      name: ENGINE_NAME,
      version: ENGINE_VERSION,
      tickSec: env.simulation.tickSec,
      sampleIntervalSec: env.simulation.sampleIntervalSec,
      arrivalModel: scenario.demand?.arrivalModel ?? 'poisson-per-tick',
    },
    assumptions,
    disclaimer: scenario.disclaimer,
    startedAt: nowIso(),
  };

  return { scenario, engine, baseDoc, durationSec, seed, demandScale };
}

function resultPatch(result, startedAt) {
  const patch = {
    status: 'completed',
    metrics: result.metrics,
    perIntersection: result.perIntersection,
    perApproach: result.perApproach,
    fairness: result.fairness,
    timeSeries: result.timeSeries,
    decisions: result.decisions,
    framesTruncated: result.framesTruncated,
    runtimeMs: Date.now() - startedAt,
    completedAt: nowIso(),
    error: null,
  };
  if (result.frames) patch.frames = result.frames;
  return patch;
}

/** Run a simulation to completion (synchronously from the API's perspective). */
export async function runSimulation(payload) {
  const plan = buildRunPlan(payload);
  const repo = getRepos().simulations;
  const doc = await repo.create(plan.baseDoc);
  const startedAt = Date.now();

  try {
    const result = plan.engine.runToCompletion();
    return await repo.update(doc.id, resultPatch(result, startedAt));
  } catch (error) {
    logger.error('Simulation run failed', { error: error.message, simulationId: doc.id });
    await repo.update(doc.id, {
      status: 'failed',
      error: error.message,
      runtimeMs: Date.now() - startedAt,
      completedAt: nowIso(),
    });
    throw error;
  }
}

/**
 * Start a live (paced) simulation. Each interval advances one simulated tick and
 * broadcasts the state on the Socket.IO room `simulation:<id>`.
 */
export async function startLiveSimulation(payload, io) {
  const plan = buildRunPlan({ ...payload, live: true });
  const repo = getRepos().simulations;
  const doc = await repo.create({ ...plan.baseDoc, live: true });
  const tickMs = payload.tickMs ?? env.live.defaultTickMs;
  const room = `simulation:${doc.id}`;
  const startedAt = Date.now();

  let lastState = null;
  let finished = false;

  const timer = setInterval(async () => {
    if (finished) return;
    try {
      const state = plan.engine.step();
      const frame = plan.engine.buildFrame(plan.engine.t);
      lastState = {
        simulationId: doc.id,
        status: plan.engine.completed ? 'completed' : 'running',
        ...state,
        vehicles: frame.vehicles,
        signals: frame.signals,
      };

      if (io) io.to(room).emit('simulation:update', lastState);
      liveRuns.set(doc.id, { status: 'running', state: lastState });

      if (plan.engine.completed) {
        finished = true;
        clearInterval(timer);
        const result = plan.engine.finalize();
        await repo.update(doc.id, resultPatch(result, startedAt));
        liveRuns.set(doc.id, { status: 'completed', state: lastState, metrics: result.metrics });

        if (io) {
          io.to(room).emit('simulation:completed', {
            simulationId: doc.id,
            status: 'completed',
            metrics: result.metrics,
          });
        }
        // Keep the final state available for a while, then evict.
        setTimeout(() => liveRuns.delete(doc.id), 10 * 60 * 1000).unref?.();
      }
    } catch (error) {
      finished = true;
      clearInterval(timer);
      logger.error('Live simulation failed', { error: error.message, simulationId: doc.id });
      await repo.update(doc.id, {
        status: 'failed',
        error: error.message,
        completedAt: nowIso(),
        runtimeMs: Date.now() - startedAt,
      });
      liveRuns.delete(doc.id);
      if (io) io.to(room).emit('simulation:failed', { simulationId: doc.id, error: error.message });
    }
  }, Math.max(20, tickMs));

  timer.unref?.();
  liveRuns.set(doc.id, { status: 'running', state: null, timer });
  return doc;
}

export async function getSimulation(id, { includeFrames = false } = {}) {
  const doc = await getRepos().simulations.findById(id);
  if (!doc) throw ApiError.notFound(`Simulation '${id}' was not found`);

  if (!includeFrames && doc.frames) {
    const { frames, ...rest } = doc;
    return { ...rest, framesIncluded: false };
  }

  return { ...doc, framesIncluded: Boolean(doc.frames) };
}

export async function getSimulationMetrics(id) {
  const doc = await getRepos().simulations.findById(id);
  if (!doc) throw ApiError.notFound(`Simulation '${id}' was not found`);

  return {
    simulationId: doc.id,
    status: doc.status,
    scenarioId: doc.scenarioId,
    mode: doc.mode,
    seed: doc.seed,
    durationSec: doc.durationSec,
    metrics: doc.metrics ?? null,
    fairness: doc.fairness ?? null,
    perIntersection: doc.perIntersection ?? [],
    perApproach: doc.perApproach ?? [],
    timeSeries: doc.timeSeries ?? [],
    decisions: doc.decisions ?? [],
    disclaimer: doc.disclaimer ?? null,
  };
}

export async function getSimulationFrames(id) {
  const doc = await getRepos().simulations.findById(id);
  if (!doc) throw ApiError.notFound(`Simulation '${id}' was not found`);

  return {
    simulationId: doc.id,
    recorded: Boolean(doc.frames && doc.frames.length),
    framesTruncated: Boolean(doc.framesTruncated),
    count: doc.frames?.length ?? 0,
    frames: doc.frames ?? [],
    note: doc.frames?.length
      ? 'Recorded frames are sampled at a fixed interval from the deterministic engine.'
      : 'This run was not recorded. Re-run with "record": true to store replay frames.',
  };
}

export async function getSimulationState(id) {
  const live = liveRuns.get(id);
  if (live?.state) {
    return {
      simulationId: id,
      status: live.status,
      live: true,
      state: live.state,
    };
  }

  const doc = await getRepos().simulations.findById(id);
  if (!doc) throw ApiError.notFound(`Simulation '${id}' was not found`);

  return {
    simulationId: id,
    status: doc.status,
    live: Boolean(live),
    state:
      doc.status === 'completed'
        ? {
            t: doc.durationSec,
            completed: true,
            mode: doc.mode,
            metrics: doc.metrics,
            timeSeries: doc.timeSeries ?? [],
          }
        : null,
  };
}

export async function listSimulations(query) {
  const { limit, offset, ...filters } = query;
  const { items, total } = await getRepos().simulations.list({
    filter: filters,
    limit,
    offset,
  });

  return {
    items: items.map((doc) => summarizeSimulation(doc)),
    pagination: {
      total,
      limit,
      offset,
      hasMore: offset + items.length < total,
    },
  };
}

export async function deleteSimulation(id) {
  const repo = getRepos().simulations;
  const doc = await repo.findById(id);
  if (!doc) throw ApiError.notFound(`Simulation '${id}' was not found`);
  await repo.delete(id);

  const live = liveRuns.get(id);
  if (live?.timer) clearInterval(live.timer);
  liveRuns.delete(id);

  return { id, deleted: true };
}

/** Used by the compare service to reuse completed run documents. */
export async function getRunDoc(id) {
  const doc = await getRepos().simulations.findById(id);
  if (!doc) throw ApiError.notFound(`Simulation '${id}' was not found`);
  return doc;
}

export function stopAllLiveRuns() {
  for (const [, run] of liveRuns) {
    if (run.timer) clearInterval(run.timer);
  }
  liveRuns.clear();
}
