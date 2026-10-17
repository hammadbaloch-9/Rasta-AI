import { asyncHandler } from '../utils/asyncHandler.js';
import { ApiError } from '../utils/ApiError.js';
import {
  runSimulation,
  startLiveSimulation,
  getSimulation,
  getSimulationMetrics,
  getSimulationFrames,
  getSimulationState,
  listSimulations,
  deleteSimulation,
  summarizeSimulation,
} from '../services/simulationService.js';
import { runComparison } from '../services/compareService.js';

export const createRun = asyncHandler(async (req, res) => {
  const payload = req.body;

  if (payload.live) {
    const doc = await startLiveSimulation(payload, req.app.get('io'));
    return res.status(202).json({
      data: summarizeSimulation(doc),
      meta: {
        live: true,
        socket: {
          event: 'simulation:update',
          subscribeEvent: 'simulation:subscribe',
          room: `simulation:${doc.id}`,
          simulationId: doc.id,
        },
        polling: `/api/simulations/${doc.id}/state`,
      },
    });
  }

  const doc = await runSimulation(payload);
  const full = await getSimulation(doc.id);

  return res.status(201).json({
    data: full,
    meta: {
      links: {
        self: `/api/simulations/${doc.id}`,
        metrics: `/api/simulations/${doc.id}/metrics`,
        frames: `/api/simulations/${doc.id}/frames`,
        hotspots: `/api/hotspots?simulationId=${doc.id}`,
      },
      note: 'All metrics are measured from simulation state. Demand is synthetic and documented in the scenario assumptions.',
    },
  });
});

export const compareRuns = asyncHandler(async (req, res) => {
  const result = await runComparison(req.body);
  res.status(201).json({
    data: result,
    meta: {
      experiment: `/api/experiments/${result.experiment.id}`,
      export: `/api/experiments/${result.experiment.id}/export?format=json`,
      note: 'Both modes used identical scenario, duration, demand and seeds.',
    },
  });
});

export const listRuns = asyncHandler(async (req, res) => {
  const result = await listSimulations(req.validatedQuery);
  res.json({ data: result.items, pagination: result.pagination });
});

export const getRun = asyncHandler(async (req, res) => {
  const includeFrames = req.query.includeFrames === 'true';
  const doc = await getSimulation(req.params.id, { includeFrames });
  res.json({ data: doc });
});

export const getRunMetrics = asyncHandler(async (req, res) => {
  const result = await getSimulationMetrics(req.params.id);
  res.json({ data: result });
});

export const getRunFrames = asyncHandler(async (req, res) => {
  const result = await getSimulationFrames(req.params.id);
  res.json({ data: result });
});

export const getRunState = asyncHandler(async (req, res) => {
  const result = await getSimulationState(req.params.id);
  res.json({ data: result });
});

export const removeRun = asyncHandler(async (req, res) => {
  const result = await deleteSimulation(req.params.id);
  res.json({ data: result });
});

export const requireCompleted = (doc) => {
  if (doc.status !== 'completed') {
    throw ApiError.conflict(`Simulation '${doc.id}' is not completed (status: ${doc.status})`);
  }
  return doc;
};
