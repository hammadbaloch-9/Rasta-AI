import { asyncHandler } from '../utils/asyncHandler.js';
import { ApiError } from '../utils/ApiError.js';
import { getRepos } from '../db/index.js';
import { detectHotspots } from '../services/hotspotService.js';
import { evaluateRecommendationsRequest } from '../services/recommendationService.js';

/**
 * GET /api/hotspots?simulationId=...
 * If no simulationId is supplied, the most recent completed simulation is used.
 */
export const listHotspots = asyncHandler(async (req, res) => {
  const { simulationId, limit, minSeverity } = req.validatedQuery;
  const repo = getRepos().simulations;

  let simulation = null;
  let derivedFrom = 'simulation_id';

  if (simulationId) {
    simulation = await repo.findById(simulationId);
    if (!simulation) throw ApiError.notFound(`Simulation '${simulationId}' was not found`);
  } else {
    const { items } = await repo.list({ filter: { status: 'completed' }, limit: 1, offset: 0 });
    simulation = items[0] || null;
    derivedFrom = 'latest_completed_simulation';
    if (!simulation) {
      throw ApiError.notFound(
        'No completed simulation exists yet. Run one with POST /api/simulations/run first.'
      );
    }
  }

  const result = detectHotspots(simulation, { limit, minSeverity });
  res.json({
    data: result,
    meta: {
      derivedFrom,
      note: 'Hotspots are screening candidates derived from simulated queues and delays, with map coordinates for context only.',
    },
  });
});

/**
 * POST /api/recommendations/evaluate
 * Body: { simulationId } | { hotspot } | { metrics }
 */
export const evaluateRecommendations = asyncHandler(async (req, res) => {
  const result = await evaluateRecommendationsRequest(req.body);
  res.json({
    data: result,
    meta: {
      note: 'Rule-based screening for further investigation. Professional traffic-engineering validation is required before any real-world action.',
    },
  });
});
