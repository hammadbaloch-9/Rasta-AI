import { scenarioById, scenarioSummaries } from '../config/scenarios.js';
import { ApiError } from '../utils/ApiError.js';

export const listScenarios = (_req, res) => {
  res.json({
    data: scenarioSummaries(),
    meta: {
      count: scenarioSummaries().length,
      note: 'All scenarios are simulated prototypes with documented assumptions; they are not measured Karachi traffic data.',
    },
  });
};

export const getScenario = (req, res) => {
  const scenario = scenarioById(req.params.id);
  if (!scenario) throw ApiError.notFound(`Scenario '${req.params.id}' was not found`);
  res.json({ data: scenario });
};
