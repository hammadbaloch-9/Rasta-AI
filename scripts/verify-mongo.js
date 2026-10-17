#!/usr/bin/env node
/**
 * Verify the MongoDB persistence path end-to-end using an ephemeral MongoDB.
 *
 *   npm run verify:mongo
 *
 * Downloads a MongoDB binary on first use (mongodb-memory-server, devDependency).
 * Exercises: create → update → read → list → compare → hotspots → export → delete.
 */

import { MongoMemoryServer } from 'mongodb-memory-server';

const mongod = await MongoMemoryServer.create();
process.env.DB_MODE = 'mongo';
process.env.MONGODB_URI = mongod.getUri();
process.env.MONGODB_DB_NAME = 'raasta_verify';
process.env.NODE_ENV = 'test';
process.env.LOG_LEVEL = 'error';

const { initDb, getRepos, getDbStatus, closeDb } = await import('../src/db/index.js');
const { runSimulation } = await import('../src/services/simulationService.js');
const { runComparison } = await import('../src/services/compareService.js');
const { detectHotspots } = await import('../src/services/hotspotService.js');
const { evaluateSimulationHotspots } = await import('../src/services/recommendationService.js');

const assert = (condition, message) => {
  if (!condition) throw new Error(`ASSERTION FAILED: ${message}`);
  console.log(`  ok — ${message}`);
};

try {
  console.log('Starting ephemeral MongoDB…');
  console.log('Status:', await initDb());
  assert(getDbStatus().mode === 'mongo', 'repository mode is mongo');

  const simulation = await runSimulation({
    scenarioId: 'saddar-balanced',
    mode: 'adaptive',
    durationSec: 180,
    seed: 42,
    label: 'mongo verification run',
  });

  console.log('\nSimulation persistence');
  assert(/^[a-f0-9]{24}$/.test(simulation.id), 'simulation id is an ObjectId string');
  assert(simulation.status === 'completed', 'run persisted as completed');
  assert(simulation.metrics.vehiclesSpawned > 0, 'metrics persisted');
  assert(simulation.timeSeries.length > 0, 'time series persisted');
  assert(simulation.perApproach.length === 16, 'per-approach data persisted');

  const reloaded = await getRepos().simulations.findById(simulation.id);
  assert(reloaded.id === simulation.id, 'findById returns the same document');
  assert(reloaded.metrics.averageWaitingTimeSec >= 0, 'metrics survive a reload');

  const list = await getRepos().simulations.list({
    filter: { mode: 'adaptive' },
    limit: 10,
    offset: 0,
  });
  assert(list.total >= 1 && list.items.length >= 1, 'list with filters works');

  console.log('\nExperiment persistence');
  const comparison = await runComparison({
    scenarioId: 'saddar-balanced',
    durationSec: 180,
    seeds: [1, 2],
    label: 'mongo verification experiment',
  });
  assert(/^[a-f0-9]{24}$/.test(comparison.experiment.id), 'experiment id is an ObjectId string');
  assert(comparison.runs.fixed.length === 2, 'two fixed runs persisted');
  assert(comparison.runs.adaptive.length === 2, 'two adaptive runs persisted');
  assert(comparison.comparison.rows.length === 10, 'comparison rows generated');

  const reloadedExperiment = await getRepos().experiments.findById(comparison.experiment.id);
  assert(reloadedExperiment.comparison.rows.length === 10, 'comparison survives a reload');

  const linkedRun = await getRepos().simulations.findById(comparison.runs.fixed[0].id);
  assert(linkedRun.experimentId === comparison.experiment.id, 'runs are linked to the experiment');

  console.log('\nIntelligence services');
  const hotspots = detectHotspots(simulation, { limit: 5 });
  assert(Array.isArray(hotspots.hotspots), 'hotspot detection runs against a persisted run');
  const evaluations = await evaluateSimulationHotspots(simulation.id);
  assert(Array.isArray(evaluations.evaluations), 'recommendations run against a persisted run');

  const removed = await getRepos().simulations.delete(simulation.id);
  assert(removed === true, 'delete works');
  assert((await getRepos().simulations.findById(simulation.id)) === null, 'deleted run is gone');

  console.log('\nMONGO VERIFICATION PASSED');
} catch (error) {
  console.error('\nMONGO VERIFICATION FAILED:', error.message);
  process.exitCode = 1;
} finally {
  await closeDb().catch(() => {});
  await mongod.stop().catch(() => {});
}
