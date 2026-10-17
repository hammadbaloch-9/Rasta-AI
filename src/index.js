import http from 'node:http';
import { Server } from 'socket.io';
import { createApp } from './app.js';
import { env } from './config/env.js';
import { logger } from './utils/logger.js';
import { initDb, closeDb } from './db/index.js';
import { initSocket } from './realtime/socket.js';
import { stopAllLiveRuns } from './services/simulationService.js';

async function main() {
  const dbStatus = await initDb();

  const app = createApp();
  const server = http.createServer(app);

  const io = new Server(server, {
    cors: {
      origin: env.corsOrigins.includes('*') ? true : env.corsOrigins,
      methods: ['GET', 'POST'],
    },
    path: '/socket.io',
  });

  app.set('io', io);
  initSocket(io);

  server.listen(env.port, env.host, () => {
    logger.info('RAASTA AI backend listening', {
      url: `http://${env.host}:${env.port}`,
      env: env.nodeEnv,
      db: dbStatus,
    });
  });

  server.on('error', (error) => {
    logger.error('HTTP server error', { error: error.message });
  });

  let shuttingDown = false;
  const shutdown = async (signal) => {
    if (shuttingDown) return;
    shuttingDown = true;
    logger.info('Shutting down', { signal });

    stopAllLiveRuns();
    io.close();

    server.close(async () => {
      await closeDb();
      process.exit(0);
    });

    setTimeout(() => process.exit(1), 10_000).unref();
  };

  process.on('SIGINT', () => shutdown('SIGINT'));
  process.on('SIGTERM', () => shutdown('SIGTERM'));
  process.on('unhandledRejection', (reason) => {
    logger.error('Unhandled promise rejection', { reason: String(reason) });
  });
  process.on('uncaughtException', (error) => {
    logger.error('Uncaught exception', { error: error.message, stack: error.stack });
  });
}

main().catch((error) => {
  logger.error('Failed to start RAASTA AI backend', { error: error.message, stack: error.stack });
  process.exit(1);
});
