export class ApiError extends Error {
  constructor(statusCode, message, details = undefined, code = undefined) {
    super(message);
    this.name = 'ApiError';
    this.statusCode = statusCode;
    this.details = details;
    this.code = code;
    this.isOperational = true;
  }

  static badRequest(message, details) {
    return new ApiError(400, message, details, 'BAD_REQUEST');
  }

  static notFound(message = 'Resource not found') {
    return new ApiError(404, message, undefined, 'NOT_FOUND');
  }

  static conflict(message, details) {
    return new ApiError(409, message, details, 'CONFLICT');
  }

  static tooManyRequests(message = 'Too many requests') {
    return new ApiError(429, message, undefined, 'RATE_LIMITED');
  }

  static internal(message = 'Internal server error', details) {
    return new ApiError(500, message, details, 'INTERNAL_ERROR');
  }

  static unavailable(message = 'Service unavailable') {
    return new ApiError(503, message, undefined, 'UNAVAILABLE');
  }
}

export default ApiError;
