import express from 'express';
import helmet from 'helmet';
import cors from 'cors';
import morgan from 'morgan';
import { env } from './config/env.js';
import { logger } from './utils/logger.js';
import { requestId } from './middleware/requestId.js';
import { notFoundHandler, errorHandler } from './middleware/errorHandler.js';
import routes from './routes/index.js';

const corsOptions = {
  origin: env.corsOrigins.includes('*') ? true : env.corsOrigins,
  methods: ['GET', 'POST', 'PUT', 'PATCH', 'DELETE', 'OPTIONS'],
  allowedHeaders: ['Content-Type', 'Authorization', 'x-request-id'],
  exposedHeaders: ['x-request-id'],
  credentials: false,
};

export function createApp({ io = null } = {}) {
  const app = express();

  app.disable('x-powered-by');
  app.set('trust proxy', true);

  app.use(helmet({ crossOriginResourcePolicy: false }));
  app.use(cors(corsOptions));
  app.use(express.json({ limit: '1mb' }));
  app.use(requestId);

  if (env.nodeEnv !== 'test') {
    morgan.token('requestId', (req) => req.id);
    app.use(
      morgan(':method :url :status :response-time ms — :requestId', {
        stream: { write: (line) => logger.debug(line.trim()) },
      })
    );
  }

  if (io) app.set('io', io);

  app.get('/', (_req, res) => {
    res.json({
      service: 'raasta-ai-backend',
      message: 'RAASTA AI — Karachi Smart Traffic Management System API',
      api: '/api',
      health: '/api/health',
      docs: 'README.md and docs/API.md',
    });
  });

  app.use('/api', routes);

  app.use(notFoundHandler);
  app.use(errorHandler);

  return app;
}

export default createApp;
