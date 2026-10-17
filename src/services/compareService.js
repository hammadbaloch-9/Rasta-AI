/**
 * Paired fixed-vs-adaptive comparison.
 *
 * Both modes receive the same scenario, duration, demand and seed (or seeds),
 * so differences in measured metrics come from the controller, not the demand.
 */

import {
  AGGREGATED_METRIC_KEYS,
  aggregateRuns,
  compareMetrics,
} from '../simulation/metrics.js';
import { scenarioById } from '../config/scenarios.js';
import { getRepos } from '../db/index.js';
import { ApiError } from '../utils/ApiError.js';
import { runSimulation, summarizeSimulation } from './simulationService.js';
import { round } from '../utils/misc.js';

function meanMetrics(runs) {
  const out = {};
  for (const key of AGGREGATED_METRIC_KEYS) {
    const values = runs.map((r) => r.metrics?.[key]).filter((v) => Number.isFinite(v));
    if (values.length) {
      out[key] = round(values.reduce((a, b) => a + b, 0) / values.length, 4);
    }
  }
  return out;
}

export async function runComparison(payload) {
  const scenario = scenarioById(payload.scenarioId);
  if (!scenario) {
    throw ApiError.notFound(
      `Unknown scenario '${payload.scenarioId}'. Use GET /api/scenarios to list available scenarios.`
    );
  }

  const seeds = payload.seeds?.length
    ? payload.seeds
    : [payload.seed ?? scenario.defaults.seed];

  const durationSec = payload.durationSec ?? scenario.defaults.durationSec;
  const base = {
    scenarioId: payload.scenarioId,
    durationSec,
    demandScale: payload.demandScale,
    overrides: payload.overrides,
  };

  const startedAt = Date.now();
  const fixedRuns = [];
  const adaptiveRuns = [];

  // Interleave modes per seed so both experience identical engine settings.
  for (const seed of seeds) {
    fixedRuns.push(
      await runSimulation({
        ...base,
        mode: 'fixed',
        seed,
        label: payload.label ? `${payload.label} — fixed — seed ${seed}` : `Fixed run — seed ${seed}`,
      })
    );
    adaptiveRuns.push(
      await runSimulation({
        ...base,
        mode: 'adaptive',
        seed,
        label: payload.label
          ? `${payload.label} — adaptive — seed ${seed}`
          : `Adaptive run — seed ${seed}`,
      })
    );
  }

  const fixedMean = meanMetrics(fixedRuns);
  const adaptiveMean = meanMetrics(adaptiveRuns);
  const comparison = compareMetrics(fixedMean, adaptiveMean, { seeds });

  const aggregate = {
    fixed: aggregateRuns(fixedRuns, AGGREGATED_METRIC_KEYS),
    adaptive: aggregateRuns(adaptiveRuns, AGGREGATED_METRIC_KEYS),
  };

  const experimentRepo = getRepos().experiments;
  const experiment = await experimentRepo.create({
    label: payload.label ?? null,
    scenarioId: scenario.id,
    scenarioName: scenario.name,
    seeds,
    durationSec,
    demandScale: payload.demandScale ?? scenario.defaults.demandScale ?? 1,
    overrides: payload.overrides || {},
    runs: {
      fixed: fixedRuns.map((r) => r.id),
      adaptive: adaptiveRuns.map((r) => r.id),
    },
    aggregate,
    comparison,
    assumptions: scenario.demand?.assumptions ?? [],
    disclaimer: scenario.disclaimer,
    runtimeMs: Date.now() - startedAt,
  });

  // Link the individual runs back to the experiment.
  const simulationRepo = getRepos().simulations;
  await Promise.all(
    [...fixedRuns, ...adaptiveRuns].map((run) =>
      simulationRepo.update(run.id, { experimentId: experiment.id })
    )
  );

  return {
    experiment: {
      id: experiment.id,
      label: experiment.label,
      scenarioId: experiment.scenarioId,
      scenarioName: experiment.scenarioName,
      seeds: experiment.seeds,
      durationSec: experiment.durationSec,
      demandScale: experiment.demandScale,
      overrides: experiment.overrides,
      createdAt: experiment.createdAt,
      runtimeMs: experiment.runtimeMs,
      disclaimer: experiment.disclaimer,
      assumptions: experiment.assumptions,
    },
    runs: {
      fixed: fixedRuns.map((r) => summarizeSimulation({ ...r, experimentId: experiment.id })),
      adaptive: adaptiveRuns.map((r) => summarizeSimulation({ ...r, experimentId: experiment.id })),
    },
    comparison,
    aggregate,
  };
}

export async function listExperiments(query) {
  const { limit, offset, ...filters } = query;
  const { items, total } = await getRepos().experiments.list({
    filter: filters,
    limit,
    offset,
  });

  return {
    items: items.map((exp) => ({
      id: exp.id,
      label: exp.label ?? null,
      scenarioId: exp.scenarioId,
      scenarioName: exp.scenarioName,
      seeds: exp.seeds,
      durationSec: exp.durationSec,
      demandScale: exp.demandScale,
      createdAt: exp.createdAt,
      verdict: exp.comparison?.summary?.verdict ?? null,
      keyFindings: exp.comparison?.summary?.keyFindings ?? [],
    })),
    pagination: { total, limit, offset, hasMore: offset + items.length < total },
  };
}

export async function getExperiment(id, { includeRuns = true } = {}) {
  const experiment = await getRepos().experiments.findById(id);
  if (!experiment) throw ApiError.notFound(`Experiment '${id}' was not found`);

  let runs = null;
  if (includeRuns) {
    const repo = getRepos().simulations;
    const [fixed, adaptive] = await Promise.all([
      Promise.all((experiment.runs?.fixed || []).map((runId) => repo.findById(runId))),
      Promise.all((experiment.runs?.adaptive || []).map((runId) => repo.findById(runId))),
    ]);
    runs = {
      fixed: fixed.filter(Boolean).map((r) => summarizeSimulation(r)),
      adaptive: adaptive.filter(Boolean).map((r) => summarizeSimulation(r)),
    };
  }

  return { ...experiment, runsDetail: runs };
}

export async function exportExperiment(id, format = 'json') {
  const experiment = await getExperiment(id, { includeRuns: true });
  if (!experiment) throw ApiError.notFound(`Experiment '${id}' was not found`);

  if (format === 'csv') {
    const rows = experiment.comparison?.rows || [];
    const header = [
      'metric',
      'unit',
      'direction',
      'fixed_mean',
      'adaptive_mean',
      'improvement_pct',
      'better',
    ];
    const lines = [header.join(',')];
    for (const r of rows) {
      lines.push(
        [
          `"${r.label}"`,
          r.unit ?? '',
          r.direction,
          r.fixed ?? '',
          r.adaptive ?? '',
          r.improvementPct ?? '',
          r.better ?? '',
        ].join(',')
      );
    }
    return {
      contentType: 'text/csv; charset=utf-8',
      filename: `raasta-experiment-${id}.csv`,
      body: lines.join('\n'),
    };
  }

  return {
    contentType: 'application/json; charset=utf-8',
    filename: `raasta-experiment-${id}.json`,
    body: JSON.stringify(
      {
        exportedAt: new Date().toISOString(),
        experiment,
        disclaimer:
          'Simulated comparison. Results depend on scenario assumptions and seeds; they are not traffic-engineering validation.',
      },
      null,
      2
    ),
  };
}
