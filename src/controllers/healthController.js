import { getDbStatus } from '../db/index.js';
import { API_VERSION, ENGINE_NAME, ENGINE_VERSION } from '../simulation/version.js';

export const health = (_req, res) => {
  res.json({
    status: 'ok',
    service: 'raasta-ai-backend',
    apiVersion: API_VERSION,
    engine: { name: ENGINE_NAME, version: ENGINE_VERSION },
    uptimeSec: Math.round(process.uptime()),
    db: getDbStatus(),
    time: new Date().toISOString(),
  });
};

export const metricDefinitions = (_req, res) => {
  res.json({
    data: {
      averageWaitingTimeSec: {
        definition:
          'Total time all vehicles spent below 0.5 m/s, divided by the number of vehicles that entered the network (spawned).',
        direction: 'lower is better',
        unit: 'seconds per vehicle',
      },
      averageTravelTimeSec: {
        definition: 'Mean elapsed time for vehicles that completed their trip and left the network.',
        direction: 'lower is better',
        unit: 'seconds',
      },
      maxQueueLength: {
        definition:
          'Largest simultaneous total of queued or stopped vehicles on any single approach, measured at each simulated tick.',
        direction: 'lower is better',
        unit: 'vehicles',
      },
      averageQueueLength: {
        definition: 'Time-averaged total number of queued/stopped vehicles across the network (or one approach).',
        direction: 'lower is better',
        unit: 'vehicles',
      },
      averageStoppedVehicles: {
        definition: 'Time-averaged count of vehicles moving slower than 0.5 m/s.',
        direction: 'lower is better',
        unit: 'vehicles',
      },
      throughputVehicles: {
        definition: 'Number of vehicles that completed their trip and exited the network during the run.',
        direction: 'higher is better',
        unit: 'vehicles',
      },
      completionRatePct: {
        definition: 'Vehicles completed divided by vehicles spawned, expressed as a percentage.',
        direction: 'higher is better',
        unit: '%',
      },
      fairnessIndex: {
        definition:
          "Jain's fairness index across per-approach average signal waits (1.0 = equal service, lower = less fair).",
        direction: 'higher is better',
        unit: 'index (0–1)',
      },
      improvementPct: {
        definition:
          'Lower-is-better metrics: (fixed − adaptive) / fixed × 100. Higher-is-better metrics: (adaptive − fixed) / fixed × 100. Positive always means adaptive performed better in the simulated comparison.',
        direction: 'higher is better for adaptive',
        unit: '%',
      },
      caveat:
        'All metrics are measured from simulation state. Demand is synthetic and documented per scenario; nothing is a real-world traffic measurement.',
    },
  });
};

export const apiIndex = (_req, res) => {
  res.json({
    name: 'RAASTA AI — Karachi Smart Traffic Management System (Backend)',
    apiVersion: API_VERSION,
    engineVersion: ENGINE_VERSION,
    docs: 'See README.md and docs/API.md',
    endpoints: {
      health: 'GET /api/health',
      metricDefinitions: 'GET /api/metrics/definitions',
      dashboard: 'GET /api/dashboard',
      scenarios: 'GET /api/scenarios, GET /api/scenarios/:id',
      runSimulation: 'POST /api/simulations/run',
      compare: 'POST /api/simulations/compare',
      simulations: 'GET /api/simulations, GET /api/simulations/:id',
      metrics: 'GET /api/simulations/:id/metrics',
      frames: 'GET /api/simulations/:id/frames',
      liveState: 'GET /api/simulations/:id/state',
      hotspots: 'GET /api/hotspots?simulationId=',
      recommendations: 'POST /api/recommendations/evaluate',
      experiments: 'GET /api/experiments, GET /api/experiments/:id',
      export: 'GET /api/experiments/:id/export?format=json|csv',
    },
    realtime: {
      transport: 'socket.io',
      subscribeEvent: 'simulation:subscribe',
      updateEvent: 'simulation:update',
      completedEvent: 'simulation:completed',
      failedEvent: 'simulation:failed',
    },
    disclaimer:
      'Decision-support prototype. Simulated demand and results are illustrative; not for controlling real traffic infrastructure.',
  });
};
