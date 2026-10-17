import test, { before, after } from 'node:test';
import assert from 'node:assert/strict';
import { createApp } from '../src/app.js';
import { initDb, closeDb } from '../src/db/index.js';

let server;
let baseUrl;

const state = {};

before(async () => {
  await initDb();
  const app = createApp();
  server = app.listen(0, '127.0.0.1');
  await new Promise((resolve) => server.once('listening', resolve));
  const { port } = server.address();
  baseUrl = `http://127.0.0.1:${port}`;
});

after(async () => {
  await new Promise((resolve) => server.close(resolve));
  await closeDb();
});

async function api(path, { method = 'GET', body } = {}) {
  const response = await fetch(`${baseUrl}${path}`, {
    method,
    headers: body ? { 'Content-Type': 'application/json' } : undefined,
    body: body ? JSON.stringify(body) : undefined,
  });
  const text = await response.text();
  let json;
  try {
    json = JSON.parse(text);
  } catch {
    json = text;
  }
  return { status: response.status, headers: response.headers, body: json };
}

test('GET /api/health reports service and db status', async () => {
  const { status, body } = await api('/api/health');
  assert.equal(status, 200);
  assert.equal(body.status, 'ok');
  assert.equal(body.service, 'raasta-ai-backend');
  assert.ok(['memory', 'mongo'].includes(body.db.mode));
});

test('GET /api/scenarios lists the Karachi scenarios with disclaimers', async () => {
  const { status, body } = await api('/api/scenarios');
  assert.equal(status, 200);
  assert.equal(body.data.length, 4);
  for (const scenario of body.data) {
    assert.equal(scenario.city, 'Karachi');
    assert.match(scenario.disclaimer, /simulated/i);
    assert.ok(scenario.assumptions.length > 0);
  }
});

test('POST /api/simulations/run executes and persists a measured run', async () => {
  const { status, body } = await api('/api/simulations/run', {
    method: 'POST',
    body: { scenarioId: 'saddar-balanced', mode: 'adaptive', durationSec: 180, seed: 42 },
  });

  assert.equal(status, 201);
  assert.equal(body.data.status, 'completed');
  assert.ok(body.data.metrics.averageWaitingTimeSec >= 0);
  assert.ok(body.data.metrics.vehiclesSpawned > 0);
  assert.equal(body.data.perIntersection.length, 4);
  assert.equal(body.data.perApproach.length, 16);
  assert.ok(body.data.timeSeries.length > 0);
  assert.equal(body.data.disclaimer.includes('Simulated'), true);

  state.simulationId = body.data.id;
});

test('GET /api/simulations/:id returns the run without frames by default', async () => {
  const { status, body } = await api(`/api/simulations/${state.simulationId}`);
  assert.equal(status, 200);
  assert.equal(body.data.id, state.simulationId);
  assert.equal(body.data.framesIncluded, false);
  assert.equal(body.data.frames, undefined);
});

test('GET /api/simulations/:id/metrics returns series and aggregates', async () => {
  const { status, body } = await api(`/api/simulations/${state.simulationId}/metrics`);
  assert.equal(status, 200);
  assert.ok(body.data.metrics);
  assert.equal(body.data.timeSeries.length > 0, true);
  assert.ok(body.data.fairness);
});

test('GET /api/dashboard aggregates the latest run for the Command Center', async () => {
  const { status, body } = await api('/api/dashboard');
  assert.equal(status, 200);
  assert.ok(body.data.latestSimulation);
  assert.ok(body.data.kpis);
  assert.ok(['low', 'medium', 'high', 'severe'].includes(body.data.kpis.congestionLevel));
  assert.ok(Array.isArray(body.data.alerts));
  assert.ok(Array.isArray(body.data.recentRuns));
});

test('GET /api/metrics/definitions documents every headline metric', async () => {
  const { status, body } = await api('/api/metrics/definitions');
  assert.equal(status, 200);
  assert.ok(body.data.averageWaitingTimeSec.definition);
  assert.ok(body.data.improvementPct.definition);
  assert.match(body.data.caveat, /synthetic|simulat/i);
});

test('GET /api/simulations supports pagination and filters', async () => {
  const { status, body } = await api('/api/simulations?limit=5&mode=adaptive');
  assert.equal(status, 200);
  assert.ok(Array.isArray(body.data));
  assert.ok(body.data.length <= 5);
  assert.ok(body.pagination.total >= 1);
  assert.equal(body.data.every((r) => r.mode === 'adaptive'), true);
});

test('GET /api/hotspots derives candidates from a simulation', async () => {
  const { status, body } = await api(`/api/hotspots?simulationId=${state.simulationId}`);
  assert.equal(status, 200);
  assert.equal(body.data.simulationId, state.simulationId);
  assert.ok(body.data.summary);
  assert.ok(Array.isArray(body.data.hotspots));
  assert.match(body.data.caveat, /synthetic|simulat/i);
});

test('POST /api/recommendations/evaluate screens hotspots', async () => {
  const { status, body } = await api('/api/recommendations/evaluate', {
    method: 'POST',
    body: { simulationId: state.simulationId },
  });
  assert.equal(status, 200);
  assert.ok(Array.isArray(body.data.evaluations));
  assert.ok(body.data.disclaimer ? true : body.data.caveat);
});

test('POST /api/simulations/compare produces a reproducible experiment', async () => {
  const { status, body } = await api('/api/simulations/compare', {
    method: 'POST',
    body: { scenarioId: 'saddar-balanced', durationSec: 180, seeds: [1, 2], label: 'API test experiment' },
  });

  assert.equal(status, 201);
  assert.equal(body.data.experiment.seeds.length, 2);
  assert.equal(body.data.runs.fixed.length, 2);
  assert.equal(body.data.runs.adaptive.length, 2);
  assert.equal(body.data.comparison.rows.length, 10);
  assert.ok(body.data.comparison.summary.verdict);

  const waitRow = body.data.comparison.rows.find((r) => r.key === 'averageWaitingTimeSec');
  assert.ok(waitRow.fixed > 0);
  assert.ok(waitRow.adaptive > 0);
  assert.equal(typeof waitRow.improvementPct, 'number');

  state.experimentId = body.data.experiment.id;
});

test('experiment history and CSV export work', async () => {
  const list = await api('/api/experiments');
  assert.equal(list.status, 200);
  assert.ok(list.body.data.length >= 1);

  const one = await api(`/api/experiments/${state.experimentId}`);
  assert.equal(one.status, 200);
  assert.ok(one.body.data.comparison.rows.length > 0);
  assert.equal(one.body.data.runsDetail.fixed.length, 2);

  const csv = await api(`/api/experiments/${state.experimentId}/export?format=csv`);
  assert.equal(csv.status, 200);
  assert.match(csv.headers.get('content-type'), /text\/csv/);
  assert.match(csv.body, /averageWaitingTimeSec|Average waiting time/);
});

test('recorded replay frames are retrievable', async () => {
  const run = await api('/api/simulations/run', {
    method: 'POST',
    body: {
      scenarioId: 'saddar-balanced',
      mode: 'fixed',
      durationSec: 60,
      seed: 3,
      record: true,
    },
  });
  assert.equal(run.status, 201);

  const frames = await api(`/api/simulations/${run.body.data.id}/frames`);
  assert.equal(frames.status, 200);
  assert.equal(frames.body.data.recorded, true);
  assert.ok(frames.body.data.count >= 50);
  assert.ok(Array.isArray(frames.body.data.frames[0].vehicles));
});

test('validation errors return structured 400 responses', async () => {
  const missing = await api('/api/simulations/run', { method: 'POST', body: {} });
  assert.equal(missing.status, 400);
  assert.equal(missing.body.error.code, 'BAD_REQUEST');
  assert.ok(missing.body.error.details.length > 0);

  const badScale = await api('/api/simulations/run', {
    method: 'POST',
    body: { scenarioId: 'saddar-balanced', demandScale: 99 },
  });
  assert.equal(badScale.status, 400);
});

test('unknown scenarios return 404 and unknown routes return 404', async () => {
  const scenario = await api('/api/simulations/run', {
    method: 'POST',
    body: { scenarioId: 'does-not-exist' },
  });
  assert.equal(scenario.status, 404);

  const route = await api('/api/not-a-route');
  assert.equal(route.status, 404);
  assert.match(route.body.error.message, /not found/i);
});

test('DELETE /api/simulations/:id removes the run', async () => {
  const removed = await api(`/api/simulations/${state.simulationId}`, { method: 'DELETE' });
  assert.equal(removed.status, 200);

  const after = await api(`/api/simulations/${state.simulationId}`);
  assert.equal(after.status, 404);
});
