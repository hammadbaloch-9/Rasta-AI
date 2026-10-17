import dotenv from 'dotenv';

dotenv.config();

const toInt = (value, fallback) => {
  const n = Number.parseInt(value, 10);
  return Number.isFinite(n) ? n : fallback;
};

const toFloat = (value, fallback) => {
  const n = Number.parseFloat(value);
  return Number.isFinite(n) ? n : fallback;
};

const toList = (value, fallback = []) =>
  value
    ? value
        .split(',')
        .map((s) => s.trim())
        .filter(Boolean)
    : fallback;

export const env = {
  nodeEnv: process.env.NODE_ENV || 'development',
  port: toInt(process.env.PORT, 4000),
  host: process.env.HOST || '0.0.0.0',

  // Database: "auto" tries Mongo when MONGODB_URI is provided, otherwise memory.
  dbMode: (process.env.DB_MODE || 'auto').toLowerCase(), // auto | mongo | memory
  mongoUri: process.env.MONGODB_URI || '',
  mongoDbName: process.env.MONGODB_DB_NAME || 'raasta_ai',
  mongoTimeoutMs: toInt(process.env.MONGODB_TIMEOUT_MS, 5000),

  corsOrigins: toList(process.env.CORS_ORIGINS, ['*']),

  simulation: {
    tickSec: toFloat(process.env.SIM_TICK_SEC, 1),
    defaultDurationSec: toInt(process.env.SIM_DEFAULT_DURATION_SEC, 600),
    minDurationSec: toInt(process.env.SIM_MIN_DURATION_SEC, 60),
    maxDurationSec: toInt(process.env.SIM_MAX_DURATION_SEC, 3600),
    sampleIntervalSec: toFloat(process.env.SIM_SAMPLE_INTERVAL_SEC, 5),
    decisionLogLimit: toInt(process.env.SIM_DECISION_LOG_LIMIT, 250),
    recordFrameIntervalSec: toFloat(process.env.SIM_RECORD_FRAME_INTERVAL_SEC, 1),
    maxRecordedFrames: toInt(process.env.SIM_MAX_RECORDED_FRAMES, 1200),
    maxFrameVehicleEntries: toInt(process.env.SIM_MAX_FRAME_VEHICLE_ENTRIES, 120000),
    maxVehiclesHardCap: toInt(process.env.SIM_MAX_VEHICLES, 8000),
  },

  // Live (streamed) simulations: real-time pacing.
  live: {
    defaultTickMs: toInt(process.env.LIVE_TICK_MS, 400),
  },

  logLevel: process.env.LOG_LEVEL || 'info',
};

export const isProduction = env.nodeEnv === 'production';
