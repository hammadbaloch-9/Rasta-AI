import mongoose from 'mongoose';

const { Schema } = mongoose;

const simulationSchema = new Schema(
  {
    label: { type: String, default: null },
    scenarioId: { type: String, required: true, index: true },
    scenarioName: { type: String, required: true },
    mode: { type: String, enum: ['fixed', 'adaptive'], required: true, index: true },
    seed: { type: Number, required: true },
    durationSec: { type: Number, required: true },
    demandScale: { type: Number, default: 1 },
    overrides: { type: Schema.Types.Mixed, default: {} },
    status: {
      type: String,
      enum: ['queued', 'running', 'completed', 'failed'],
      default: 'queued',
      index: true,
    },
    live: { type: Boolean, default: false },

    // Simulation output
    metrics: { type: Schema.Types.Mixed, default: null },
    perIntersection: { type: [Schema.Types.Mixed], default: [] },
    perApproach: { type: [Schema.Types.Mixed], default: [] },
    fairness: { type: Schema.Types.Mixed, default: null },
    timeSeries: { type: [Schema.Types.Mixed], default: [] },
    decisions: { type: [Schema.Types.Mixed], default: [] },
    frames: { type: [Schema.Types.Mixed], default: undefined },
    framesTruncated: { type: Boolean, default: false },

    // Provenance / honesty metadata
    engine: { type: Schema.Types.Mixed, default: null },
    assumptions: { type: [String], default: [] },
    disclaimer: { type: String, default: null },

    experimentId: { type: String, default: null, index: true },
    runtimeMs: { type: Number, default: null },
    error: { type: String, default: null },
    startedAt: { type: Date, default: null },
    completedAt: { type: Date, default: null },
  },
  {
    timestamps: true,
    toJSON: {
      virtuals: true,
      transform: (_doc, ret) => {
        ret.id = ret._id.toString();
        delete ret._id;
        delete ret.__v;
        return ret;
      },
    },
    toObject: {
      virtuals: true,
      transform: (_doc, ret) => {
        ret.id = ret._id.toString();
        delete ret._id;
        delete ret.__v;
        return ret;
      },
    },
  }
);

simulationSchema.index({ createdAt: -1 });
simulationSchema.index({ scenarioId: 1, mode: 1, seed: 1 });

export const Simulation = mongoose.models.Simulation || mongoose.model('Simulation', simulationSchema);

export default Simulation;
