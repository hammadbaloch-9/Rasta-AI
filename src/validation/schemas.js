import { z } from 'zod';
import { env } from '../config/env.js';

const sides = ['N', 'S', 'E', 'W'];
const MIN_DURATION = env.simulation.minDurationSec;
const MAX_DURATION = env.simulation.maxDurationSec;

const signalOverrideSchema = z
  .object({
    minGreenSec: z.number().min(4).max(90).optional(),
    maxGreenSec: z.number().min(10).max(180).optional(),
    amberSec: z.number().min(1).max(10).optional(),
    allRedSec: z.number().min(0).max(10).optional(),
    fixedCycleSec: z.number().min(20).max(300).optional(),
    fixedSplit: z.number().min(0.2).max(0.8).optional(),
    switchMargin: z.number().min(0).max(2).optional(),
    starvationWaitSec: z.number().min(20).max(600).optional(),
    minMeaningfulScore: z.number().min(0).max(1).optional(),
    saturationFlowPerLane: z.number().min(900).max(2400).optional(),
    emergencyExtraGreenSec: z.number().min(0).max(120).optional(),
    emergencyLookaheadM: z.number().min(50).max(800).optional(),
  })
  .strict();

const overridesSchema = z
  .object({
    demandScale: z.number().min(0.1).max(3).optional(),
    laneOverrides: z
      .record(
        z.object({
          lanesPerApproach: z.number().int().min(1).max(6),
        })
      )
      .optional(),
    signal: signalOverrideSchema.optional(),
    blockApproaches: z
      .array(
        z
          .object({
            intersectionId: z.string().min(1),
            approach: z.enum(sides),
            reason: z.string().max(200).optional(),
          })
          .strict()
      )
      .max(12)
      .optional(),
    clearBlocked: z.boolean().optional(),
    emergency: z
      .object({
        enabled: z.boolean(),
        afterSec: z.number().min(0).max(MAX_DURATION).optional(),
        entryIntersectionId: z.string().min(1),
        entrySide: z.enum(sides),
        destinationIntersectionId: z.string().min(1).optional(),
      })
      .strict()
      .optional(),
  })
  .strict()
  .optional();

export const runSimulationSchema = z
  .object({
    scenarioId: z.string().min(1),
    mode: z.enum(['fixed', 'adaptive']).default('adaptive'),
    durationSec: z.number().int().min(MIN_DURATION).max(MAX_DURATION).optional(),
    seed: z.number().int().min(0).max(2147483647).optional(),
    demandScale: z.number().min(0.1).max(3).optional(),
    label: z.string().trim().max(120).optional(),
    live: z.boolean().default(false),
    tickMs: z.number().int().min(50).max(2000).optional(),
    record: z.boolean().default(false),
    recordFrameIntervalSec: z.number().min(0.5).max(10).optional(),
    overrides: overridesSchema,
  })
  .strict();

export const compareSchema = z
  .object({
    scenarioId: z.string().min(1),
    durationSec: z.number().int().min(MIN_DURATION).max(MAX_DURATION).optional(),
    seed: z.number().int().min(0).max(2147483647).optional(),
    seeds: z.array(z.number().int().min(0).max(2147483647)).min(1).max(10).optional(),
    demandScale: z.number().min(0.1).max(3).optional(),
    label: z.string().trim().max(120).optional(),
    overrides: overridesSchema,
  })
  .strict();

export const listSimulationsQuerySchema = z
  .object({
    limit: z.coerce.number().int().min(1).max(100).default(20),
    offset: z.coerce.number().int().min(0).default(0),
    scenarioId: z.string().min(1).optional(),
    mode: z.enum(['fixed', 'adaptive']).optional(),
    status: z.enum(['queued', 'running', 'completed', 'failed']).optional(),
    experimentId: z.string().min(1).optional(),
  })
  .strict();

export const hotspotsQuerySchema = z
  .object({
    simulationId: z.string().min(1).optional(),
    limit: z.coerce.number().int().min(1).max(50).default(10),
    minSeverity: z.enum(['low', 'medium', 'high', 'critical']).optional(),
  })
  .strict();

export const evaluateRecommendationsSchema = z
  .object({
    simulationId: z.string().min(1).optional(),
    hotspot: z.record(z.any()).optional(),
    metrics: z.record(z.any()).optional(),
  })
  .strict()
  .refine((value) => value.simulationId || value.hotspot || value.metrics, {
    message: 'Provide simulationId, hotspot or metrics',
  });

export const listExperimentsQuerySchema = z
  .object({
    limit: z.coerce.number().int().min(1).max(100).default(20),
    offset: z.coerce.number().int().min(0).default(0),
    scenarioId: z.string().min(1).optional(),
  })
  .strict();

export const exportQuerySchema = z
  .object({
    format: z.enum(['json', 'csv']).default('json'),
  })
  .strict();
