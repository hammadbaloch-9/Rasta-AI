import mongoose from 'mongoose';

const { Schema } = mongoose;

const experimentSchema = new Schema(
  {
    label: { type: String, default: null },
    scenarioId: { type: String, required: true, index: true },
    scenarioName: { type: String, required: true },
    seeds: { type: [Number], required: true },
    durationSec: { type: Number, required: true },
    demandScale: { type: Number, default: 1 },
    overrides: { type: Schema.Types.Mixed, default: {} },

    runs: {
      fixed: { type: [String], default: [] },
      adaptive: { type: [String], default: [] },
    },

    // Aggregate metric objects per mode: { metricKey: { mean, stdDev, min, max } }
    aggregate: { type: Schema.Types.Mixed, default: null },
    // Row-by-row comparison: { rows, summary }
    comparison: { type: Schema.Types.Mixed, default: null },

    assumptions: { type: [String], default: [] },
    disclaimer: { type: String, default: null },
    runtimeMs: { type: Number, default: null },
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

experimentSchema.index({ createdAt: -1 });

export const Experiment = mongoose.models.Experiment || mongoose.model('Experiment', experimentSchema);

export default Experiment;
