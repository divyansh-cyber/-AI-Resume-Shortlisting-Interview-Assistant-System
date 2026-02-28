/**
 * Base application error — carries an HTTP status code so the global
 * error handler can respond consistently without re-checking instanceof.
 */
export class AppError extends Error {
  constructor(
    public readonly message: string,
    public readonly statusCode: number = 500,
    public readonly code?: string,
  ) {
    super(message);
    this.name = this.constructor.name;
    Error.captureStackTrace(this, this.constructor);
  }
}

export class ValidationError extends AppError {
  constructor(message: string, public readonly details?: unknown) {
    super(message, 400, 'VALIDATION_ERROR');
  }
}

export class NotFoundError extends AppError {
  constructor(resource: string, id?: string) {
    super(id ? `${resource} with id '${id}' not found` : `${resource} not found`, 404, 'NOT_FOUND');
  }
}

export class ExternalServiceError extends AppError {
  constructor(service: string, cause?: string) {
    super(`External service '${service}' failed${cause ? `: ${cause}` : ''}`, 502, 'EXTERNAL_SERVICE_ERROR');
  }
}

export class RateLimitError extends AppError {
  constructor(service: string) {
    super(`Rate limit reached for '${service}'. Please retry later.`, 429, 'RATE_LIMIT');
  }
}

/** Type-guard for AppError */
export function isAppError(err: unknown): err is AppError {
  return err instanceof AppError;
}
