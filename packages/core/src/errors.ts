import type { Context } from 'hono';

export const ERROR_CODES = {
  UNAUTHORIZED: 'UNAUTHORIZED',
  FORBIDDEN: 'FORBIDDEN',
  NOT_FOUND: 'NOT_FOUND',
  VALIDATION: 'VALIDATION',
  CONFLICT: 'CONFLICT',
  INTERNAL: 'INTERNAL',
  DB_BUSY: 'DB_BUSY',
} as const;

export type ErrorCode = keyof typeof ERROR_CODES;

export class VobaseError extends Error {
  constructor(
    message: string,
    public readonly code: ErrorCode,
    public readonly statusCode: number,
    public readonly details?: object
  ) {
    super(message);
    this.name = 'VobaseError';
  }
}

export const unauthorized = (message = 'Unauthorized') =>
  new VobaseError(message, 'UNAUTHORIZED', 401);

export const forbidden = (message = 'Forbidden') =>
  new VobaseError(message, 'FORBIDDEN', 403);

export const notFound = (resource: string) =>
  new VobaseError(`${resource} not found`, 'NOT_FOUND', 404);

export const validation = (details: object, message = 'Validation failed') =>
  new VobaseError(message, 'VALIDATION', 400, details);

export const conflict = (resource: string) =>
  new VobaseError(`${resource} already exists`, 'CONFLICT', 409);

export const dbBusy = () =>
  new VobaseError('Database busy, try again', 'DB_BUSY', 503);

export const errorHandler = (err: Error, c: Context): Response => {
  if (err instanceof VobaseError) {
    return c.json(
      {
        error: {
          code: err.code,
          message: err.message,
          details: err.details,
        },
      },
      err.statusCode
    );
  }
  console.error('Unhandled error:', err);
  return c.json(
    { error: { code: 'INTERNAL', message: 'Internal server error' } },
    500
  );
};
