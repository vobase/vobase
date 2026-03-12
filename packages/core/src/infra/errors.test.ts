import { describe, expect, it, mock } from 'bun:test';
import type { Context } from 'hono';

import {
  conflict,
  dbBusy,
  ERROR_CODES,
  errorHandler,
  forbidden,
  notFound,
  unauthorized,
  VobaseError,
  validation,
} from './errors';

describe('VobaseError', () => {
  it('should create an error with correct properties', () => {
    const err = new VobaseError('Test error', 'INTERNAL', 500);
    expect(err).toBeInstanceOf(VobaseError);
    expect(err).toBeInstanceOf(Error);
    expect(err.message).toBe('Test error');
    expect(err.code).toBe('INTERNAL');
    expect(err.statusCode).toBe(500);
    expect(err.name).toBe('VobaseError');
  });

  it('should support details object', () => {
    const details = { field: 'email', reason: 'invalid' };
    const err = new VobaseError('Invalid', 'VALIDATION', 400, details);
    expect(err.details).toEqual(details);
  });
});

describe('Factory functions', () => {
  it('unauthorized() should produce 401 error', () => {
    const err = unauthorized();
    expect(err).toBeInstanceOf(VobaseError);
    expect(err.statusCode).toBe(401);
    expect(err.code).toBe('UNAUTHORIZED');
    expect(err.message).toBe('Unauthorized');
  });

  it('unauthorized() should accept custom message', () => {
    const err = unauthorized('Access denied');
    expect(err.message).toBe('Access denied');
  });

  it('forbidden() should produce 403 error', () => {
    const err = forbidden();
    expect(err.statusCode).toBe(403);
    expect(err.code).toBe('FORBIDDEN');
  });

  it('notFound() should include resource name in message', () => {
    const err = notFound('Invoice');
    expect(err.statusCode).toBe(404);
    expect(err.code).toBe('NOT_FOUND');
    expect(err.message).toContain('Invoice');
    expect(err.message).toBe('Invoice not found');
  });

  it('validation() should include details', () => {
    const details = { field: 'email', reason: 'required' };
    const err = validation(details);
    expect(err.statusCode).toBe(400);
    expect(err.code).toBe('VALIDATION');
    expect(err.details).toEqual(details);
  });

  it('validation() should accept custom message', () => {
    const err = validation({}, 'Custom validation error');
    expect(err.message).toBe('Custom validation error');
  });

  it('conflict() should include resource name in message', () => {
    const err = conflict('User');
    expect(err.statusCode).toBe(409);
    expect(err.code).toBe('CONFLICT');
    expect(err.message).toContain('User');
    expect(err.message).toBe('User already exists');
  });

  it('dbBusy() should produce 503 error', () => {
    const err = dbBusy();
    expect(err.statusCode).toBe(503);
    expect(err.code).toBe('DB_BUSY');
  });
});

describe('errorHandler', () => {
  it('should handle VobaseError and return correct JSON', () => {
    const mockContext = {
      json: mock((data, status) => ({
        data,
        status,
      })),
    };

    const err = notFound('Invoice');
    errorHandler(err, mockContext as unknown as Context);

    expect(mockContext.json).toHaveBeenCalledWith(
      {
        error: {
          code: 'NOT_FOUND',
          message: 'Invoice not found',
          details: undefined,
        },
      },
      404,
    );
  });

  it('should include details in VobaseError response', () => {
    const mockContext = {
      json: mock((data, status) => ({
        data,
        status,
      })),
    };

    const details = { field: 'email' };
    const err = validation(details, 'Invalid email');
    errorHandler(err, mockContext as unknown as Context);

    expect(mockContext.json).toHaveBeenCalledWith(
      {
        error: {
          code: 'VALIDATION',
          message: 'Invalid email',
          details,
        },
      },
      400,
    );
  });

  it('should handle unknown errors with 500', () => {
    const mockContext = {
      json: mock((data, status) => ({
        data,
        status,
      })),
    };

    const consoleErrorMock = mock(() => {});
    console.error = consoleErrorMock;

    const err = new Error('Unknown error');
    errorHandler(err, mockContext as unknown as Context);

    expect(mockContext.json).toHaveBeenCalledWith(
      {
        error: {
          code: 'INTERNAL',
          message: 'Internal server error',
        },
      },
      500,
    );
    expect(consoleErrorMock).toHaveBeenCalled();
  });
});

describe('ERROR_CODES', () => {
  it('should have all required error codes', () => {
    expect(ERROR_CODES.UNAUTHORIZED).toBe('UNAUTHORIZED');
    expect(ERROR_CODES.FORBIDDEN).toBe('FORBIDDEN');
    expect(ERROR_CODES.NOT_FOUND).toBe('NOT_FOUND');
    expect(ERROR_CODES.VALIDATION).toBe('VALIDATION');
    expect(ERROR_CODES.CONFLICT).toBe('CONFLICT');
    expect(ERROR_CODES.INTERNAL).toBe('INTERNAL');
    expect(ERROR_CODES.DB_BUSY).toBe('DB_BUSY');
  });
});
