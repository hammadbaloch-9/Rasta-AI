import { ApiError } from '../utils/ApiError.js';
import { logger } from '../utils/logger.js';
import { isProduction } from '../config/env.js';

export const notFoundHandler = (req, _res, next) => {
  next(ApiError.notFound(`Route ${req.method} ${req.originalUrl} was not found`));
};

// eslint-disable-next-line no-unused-vars
export const errorHandler = (err, req, res, _next) => {
  let statusCode = err.statusCode || 500;
  let message = err.message || 'Internal server error';
  let code = err.code || 'INTERNAL_ERROR';
  let details = err.details;

  // Body-parser / JSON syntax errors
  if (err.type === 'entity.parse.failed' || err instanceof SyntaxError) {
    statusCode = 400;
    code = 'INVALID_JSON';
    message = 'Request body is not valid JSON';
  }

  // Mongoose cast errors (invalid ObjectId etc.)
  if (err.name === 'CastError') {
    statusCode = 400;
    code = 'INVALID_ID';
    message = `Invalid value for ${err.path}`;
  }

  if (err.name === 'ValidationError') {
    statusCode = 400;
    code = 'VALIDATION_ERROR';
    details = Object.values(err.errors || {}).map((e) => e.message);
  }

  if (statusCode >= 500) {
    logger.error('Unhandled request error', {
      requestId: req.id,
      path: req.originalUrl,
      method: req.method,
      error: err.message,
      stack: err.stack,
    });
  } else {
    logger.debug('Request rejected', {
      requestId: req.id,
      path: req.originalUrl,
      statusCode,
      message,
    });
  }

  if (res.headersSent) return;

  res.status(statusCode).json({
    error: {
      message:
        statusCode >= 500 && isProduction
          ? 'Internal server error'
          : message,
      code,
      requestId: req.id,
      ...(details ? { details } : {}),
    },
  });
};
