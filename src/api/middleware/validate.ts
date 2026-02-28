import { Request, Response, NextFunction } from 'express';
import { ZodSchema, ZodError } from 'zod';
import { ValidationError } from '../../utils/errors';

/**
 * Returns an Express middleware that validates req.body against the given
 * Zod schema.  On failure it throws a `ValidationError` (400) with the
 * Zod field-level messages so the client knows exactly what to fix.
 */
export function validateBody<T>(schema: ZodSchema<T>) {
  return (req: Request, _res: Response, next: NextFunction): void => {
    const result = schema.safeParse(req.body);
    if (!result.success) {
      const msg = formatZodError(result.error);
      throw new ValidationError(msg, result.error.flatten().fieldErrors);
    }
    req.body = result.data as typeof req.body;
    next();
  };
}

/**
 * Returns an Express middleware that validates req.params against a schema.
 */
export function validateParams<T>(schema: ZodSchema<T>) {
  return (req: Request, _res: Response, next: NextFunction): void => {
    const result = schema.safeParse(req.params);
    if (!result.success) {
      throw new ValidationError(formatZodError(result.error));
    }
    next();
  };
}

/**
 * Returns an Express middleware that validates req.query against a schema.
 */
export function validateQuery<T>(schema: ZodSchema<T>) {
  return (req: Request, _res: Response, next: NextFunction): void => {
    const result = schema.safeParse(req.query);
    if (!result.success) {
      throw new ValidationError(formatZodError(result.error));
    }
    next();
  };
}

function formatZodError(err: ZodError): string {
  return err.errors.map((e) => `${e.path.join('.')}: ${e.message}`).join('; ');
}
