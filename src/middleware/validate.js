import { ApiError } from '../utils/ApiError.js';

/**
 * Validate a request segment against a zod schema.
 * @param {import('zod').ZodTypeAny} schema
 * @param {'body'|'query'|'params'} source
 */
export const validate = (schema, source = 'body') => (req, _res, next) => {
  const result = schema.safeParse(req[source] ?? {});

  if (!result.success) {
    const details = result.error.issues.map((issue) => ({
      path: issue.path.join('.') || source,
      message: issue.message,
      code: issue.code,
    }));
    return next(ApiError.badRequest('Request validation failed', details));
  }

  // Express 4 allows replacing query/body; params is readonly in some versions.
  if (source === 'body') req.body = result.data;
  else if (source === 'query') req.validatedQuery = result.data;
  else req.validatedParams = result.data;

  next();
};

export default validate;
