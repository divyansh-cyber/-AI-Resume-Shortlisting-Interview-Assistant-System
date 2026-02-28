import { Request, Response, NextFunction } from 'express';
import { ZodError } from 'zod';
import { isAppError } from '../../utils/errors';
import { logger } from '../../utils/logger';

/**
 * Global error handler — must be the last middleware registered in app.ts.
 *
 * Converts AppError subclasses to their HTTP status + code, and wraps
 * any unexpected error as a generic 500 so we never leak stack traces
 * to clients in production.
 */
export function errorHandler(
  err: unknown,
  req: Request,
  res: Response,
  // eslint-disable-next-line @typescript-eslint/no-unused-vars
  _next: NextFunction,
): void {
  // Zod validation errors → 400 Bad Request
  if (err instanceof ZodError) {
    logger.warn('Validation error', { method: req.method, path: req.path, issues: err.issues });
    res.status(400).json({
      error: {
        code: 'VALIDATION_ERROR',
        message: 'Request validation failed.',
        details: err.issues.map((i) => ({ path: i.path.join('.'), message: i.message })),
      },
    });
    return;
  }

  if (isAppError(err)) {
    if (err.statusCode >= 500) {
      logger.error('Application error', {
        method: req.method,
        path: req.path,
        statusCode: err.statusCode,
        message: err.message,
        code: err.code,
      });
    } else {
      logger.warn('Client error', {
        method: req.method,
        path: req.path,
        statusCode: err.statusCode,
        message: err.message,
        code: err.code,
      });
    }

    res.status(err.statusCode).json({
      error: {
        code: err.code ?? 'APPLICATION_ERROR',
        message: err.message,
      },
    });
    return;
  }

  // Unexpected error — log full details but hide them from the client
  logger.error('Unhandled error', {
    method: req.method,
    path: req.path,
    err,
  });

  res.status(500).json({
    error: {
      code: 'INTERNAL_SERVER_ERROR',
      message: 'An unexpected error occurred.',
    },
  });
}
