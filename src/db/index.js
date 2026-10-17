import mongoose from 'mongoose';
import { env } from '../config/env.js';
import { logger } from '../utils/logger.js';
import { createMemoryRepositories } from './memory.js';
import { createMongoRepositories } from './mongo.js';

let repositories = createMemoryRepositories();
let status = {
  mode: 'memory',
  connected: false,
  reason: 'Database not initialised yet',
};

export async function initDb() {
  const { dbMode, mongoUri, mongoDbName, mongoTimeoutMs } = env;

  if (dbMode === 'memory') {
    repositories = createMemoryRepositories();
    status = { mode: 'memory', connected: false, reason: 'DB_MODE=memory (ephemeral store)' };
    logger.info('Using in-memory data store', { reason: status.reason });
    return getDbStatus();
  }

  if (!mongoUri) {
    if (dbMode === 'mongo') {
      throw new Error('DB_MODE=mongo requires MONGODB_URI to be set');
    }
    repositories = createMemoryRepositories();
    status = { mode: 'memory', connected: false, reason: 'MONGODB_URI not set (ephemeral store)' };
    logger.warn('MONGODB_URI not set — falling back to the in-memory store');
    return getDbStatus();
  }

  try {
    await mongoose.connect(mongoUri, {
      dbName: mongoDbName,
      serverSelectionTimeoutMS: mongoTimeoutMs,
    });
    repositories = createMongoRepositories();
    status = { mode: 'mongo', connected: true, reason: null };
    logger.info('Connected to MongoDB', { dbName: mongoDbName });
  } catch (error) {
    if (dbMode === 'mongo') throw error;
    repositories = createMemoryRepositories();
    status = {
      mode: 'memory',
      connected: false,
      reason: `MongoDB unavailable (${error.message}); using ephemeral store`,
    };
    logger.warn('MongoDB connection failed — falling back to the in-memory store', {
      error: error.message,
    });
  }

  return getDbStatus();
}

export function getRepos() {
  return repositories;
}

export function getDbStatus() {
  return {
    mode: status.mode,
    connected: mongoose.connection.readyState === 1,
    reason: status.reason,
    persistent: status.mode === 'mongo' && mongoose.connection.readyState === 1,
  };
}

export async function closeDb() {
  if (mongoose.connection.readyState !== 0) {
    await mongoose.disconnect().catch(() => {});
  }
}
