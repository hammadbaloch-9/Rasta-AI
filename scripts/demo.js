#!/usr/bin/env node
/**
 * RAASTA AI — end-to-end demo against a running backend.
 *
 *   npm start                # terminal 1
 *   npm run demo             # terminal 2
 *
 * Runs a fixed baseline and an adaptive run on the same scenario/seed,
 * compares them over multiple seeds, detects hotspots, screens interventions
 * and writes a Markdown + JSON report to ./reports.
 */

import { mkdir, writeFile } from 'node:fs/promises';
import path from 'node:path';

const BASE = process.env.RAASTA_API_URL || 'http://localhost:4000';
const SCENARIO = process.env.DEMO_SCENARIO || 'saddar-balanced';
const DURATION = Number(process.env.DEMO_DURATION || 600);
const SEEDS = (process.env.DEMO_SEEDS || '1,2,3').split(',').map(Number);

async function request(endpoint, { method = 'GET', body } = {}) {
  const res = await fetch(`${BASE}${endpoint}`, {
    method,
    headers: body ? { 'Content-Type': 'application/json' } : undefined,
    body: body ? JSON.stringify(body) : undefined,
  });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) {
    throw new Error(
      `${method} ${endpoint} failed (${res.status}): ${data?.error?.message || 'unknown error'}`
    );
  }
  return data;
}

const line = () => console.log('-'.repeat(78));
const pad = (v, n) => String(v).padEnd(n);

function printMetrics(title, metrics) {
  console.log(`\n${title}`);
  const rows = [
    ['Average waiting time', `${metrics.averageWaitingTimeSec} s`],
    ['Average travel time', `${metrics.averageTravelTimeSec} s`],
    ['Max queue length', `${metrics.maxQueueLength} vehicles`],
    ['Average queue length', `${metrics.averageQueueLength} vehicles`],
    ['Throughput', `${metrics.throughputVehicles} trips (${metrics.throughputVehPerHour}/h)`],
    ['Completion rate', `${metrics.completionRatePct} %`],
    ['Fairness (Jain)', metrics.fairnessIndex],
    ['Signal switches', metrics.phaseSwitches],
  ];
  for (const [k, v] of rows) console.log(`  ${pad(k, 26)} ${v}`);
}

function printComparison(comparison) {
  console.log('\nComparison (positive improvement = adaptive better)');
  console.log(
    `  ${pad('Metric', 34)} ${pad('Fixed', 12)} ${pad('Adaptive', 12)} ${pad('Change', 10)}`
  );
  for (const row of comparison.rows) {
    const change = row.improvementPct === null ? 'n/a' : `${row.improvementPct > 0 ? '+' : ''}${row.improvementPct}%`;
    console.log(`  ${pad(row.label, 34)} ${pad(row.fixed, 12)} ${pad(row.adaptive, 12)} ${pad(change, 10)}`);
  }
  console.log('\nVerdict:', comparison.summary.verdict);
  for (const finding of comparison.summary.keyFindings) console.log('  •', finding);
}

async function main() {
  console.log('RAASTA AI — Karachi Traffic Decision Lab (backend demo)');
  console.log(`API: ${BASE}\n`);

  const health = await request('/api/health');
  console.log('Health:', health.status, '| DB:', health.db.mode, '| engine:', health.engine.version);

  const { data: scenarios } = await request('/api/scenarios');
  const scenario = scenarios.find((s) => s.id === SCENARIO) || scenarios[0];
  console.log(`Scenario: ${scenario.name} (${scenario.id})`);
  console.log(`Demand: ${scenario.totalEntryDemandVehPerHour} veh/h across boundary entries (simulated)\n`);

  line();
  console.log('1. Fixed-time baseline');
  const fixed = (await request('/api/simulations/run', {
    method: 'POST',
    body: { scenarioId: scenario.id, mode: 'fixed', durationSec: DURATION, seed: 42, label: 'Demo baseline' },
  })).data;
  printMetrics('Fixed-time metrics', fixed.metrics);

  console.log('\n2. Adaptive control with the same demand, duration and seed');
  const adaptive = (await request('/api/simulations/run', {
    method: 'POST',
    body: { scenarioId: scenario.id, mode: 'adaptive', durationSec: DURATION, seed: 42, label: 'Demo adaptive' },
  })).data;
  printMetrics('Adaptive metrics', adaptive.metrics);

  console.log('\n3. Multi-seed paired experiment');
  const experiment = (await request('/api/simulations/compare', {
    method: 'POST',
    body: {
      scenarioId: scenario.id,
      durationSec: DURATION,
      seeds: SEEDS,
      label: 'Demo experiment',
    },
  })).data;
  printComparison(experiment.comparison);
  console.log(`\nExperiment saved: ${experiment.experiment.id} (seeds: ${SEEDS.join(', ')})`);

  console.log('\n4. Hotspot detection on the fixed-time run');
  const hotspots = (await request(`/api/hotspots?simulationId=${fixed.id}&limit=5`)).data;
  console.log(
    `Candidates: ${hotspots.summary.totalCandidates} | by severity: ${JSON.stringify(hotspots.summary.bySeverity)}`
  );
  for (const hotspot of hotspots.hotspots.slice(0, 5)) {
    console.log(
      `  • ${hotspot.intersectionId} ${hotspot.side} — ${hotspot.severity} (score ${hotspot.score}) — ${hotspot.likelyCauses.join(', ')}`
    );
  }

  console.log('\n5. Intervention screening');
  const recommendations = (await request('/api/recommendations/evaluate', {
    method: 'POST',
    body: { simulationId: fixed.id },
  })).data;
  for (const evaluation of recommendations.evaluations.slice(0, 3)) {
    console.log(`  ${evaluation.intersectionId} ${evaluation.side}:`);
    for (const intervention of evaluation.interventions) {
      console.log(
        `    - ${intervention.type} (${intervention.confidence} confidence${intervention.studyRequired ? ', further study required' : ''})`
      );
    }
  }
  if (!recommendations.evaluations.length) {
    console.log('  No hotspot exceeded the thresholds for this run.');
  }

  // --- Persist a report -----------------------------------------------------
  const stamp = new Date().toISOString().replace(/[:.]/g, '-');
  const reportsDir = path.resolve('reports');
  await mkdir(reportsDir, { recursive: true });

  const report = {
    generatedAt: new Date().toISOString(),
    scenario: { id: scenario.id, name: scenario.name, disclaimer: scenario.disclaimer },
    runs: { fixed: fixed.id, adaptive: adaptive.id },
    fixedMetrics: fixed.metrics,
    adaptiveMetrics: adaptive.metrics,
    experiment: experiment.experiment,
    comparison: experiment.comparison,
    hotspots: hotspots.hotspots,
    recommendations: recommendations.evaluations,
    disclaimer:
      'Simulated results with synthetic demand. Not traffic-engineering validation and not a basis for construction decisions.',
  };

  const jsonPath = path.join(reportsDir, `raasta-demo-${stamp}.json`);
  await writeFile(jsonPath, JSON.stringify(report, null, 2));

  const md = [
    '# RAASTA AI — Demo Report',
    '',
    `Generated: ${new Date().toISOString()}`,
    `Scenario: **${scenario.name}** (\`${scenario.id}\`)`,
    `Duration: ${DURATION}s · Seeds: ${SEEDS.join(', ')}`,
    '',
    '## Comparison (positive = adaptive better)',
    '',
    '| Metric | Fixed | Adaptive | Change |',
    '| --- | ---: | ---: | ---: |',
    ...experiment.comparison.rows.map(
      (r) =>
        `| ${r.label} (${r.unit || '—'}) | ${r.fixed} | ${r.adaptive} | ${
          r.improvementPct === null ? 'n/a' : `${r.improvementPct}%`
        } |`
    ),
    '',
    `**Verdict:** ${experiment.comparison.summary.verdict}`,
    '',
    ...experiment.comparison.summary.keyFindings.map((f) => `- ${f}`),
    '',
    '## Hotspots (fixed-time baseline)',
    '',
    hotspots.hotspots.length
      ? '| Intersection | Approach | Severity | Score | Likely causes |'
      : 'No hotspots crossed the thresholds in this run.',
    ...(hotspots.hotspots.length
      ? [
          '| --- | --- | --- | --- | --- |',
          ...hotspots.hotspots.map(
            (h) =>
              `| ${h.intersectionName} (${h.intersectionId}) | ${h.side} | ${h.severity} | ${h.score} | ${h.likelyCauses.join(', ')} |`
          ),
        ]
      : []),
    '',
    '## Intervention screening',
    '',
    '| Intersection | Approach | Interventions | Confidence | Further study |',
    '| --- | --- | --- | --- | --- |',
    ...recommendations.evaluations.map(
      (e) =>
        `| ${e.intersectionName} | ${e.side} | ${e.interventions
          .map((i) => i.type)
          .join(', ')} | ${e.interventions.map((i) => i.confidence).join(', ')} | ${
          e.interventions.some((i) => i.studyRequired) ? 'yes' : 'no'
        } |`
    ),
    '',
    '> Simulated results with synthetic demand. Preliminary screening only — professional traffic-engineering validation is required.',
    '',
  ].join('\n');

  const mdPath = path.join(reportsDir, `raasta-demo-${stamp}.md`);
  await writeFile(mdPath, md);

  line();
  console.log('Report written:');
  console.log('  ', jsonPath);
  console.log('  ', mdPath);
  console.log(
    '\nReminder: all values are simulated. This prototype does not control real traffic and cannot justify construction.'
  );
}

main().catch((error) => {
  console.error('\nDemo failed:', error.message);
  if (error.cause?.code === 'ECONNREFUSED') {
    console.error('Is the backend running? Start it with: npm start');
  }
  process.exit(1);
});
