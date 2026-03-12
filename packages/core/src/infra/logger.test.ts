import { afterEach, beforeEach, describe, expect, it } from 'bun:test';

import { logger } from './logger';

describe('logger', () => {
  let logs: string[] = [];
  const originalLog = console.log;

  beforeEach(() => {
    logs = [];
    console.log = (msg: string) => logs.push(msg);
  });

  afterEach(() => {
    console.log = originalLog;
  });

  it('should log info messages', () => {
    logger.info('test message', { foo: 'bar' });
    expect(logs.length).toBe(1);
    const parsed = JSON.parse(logs[0]);
    expect(parsed.level).toBe('info');
    expect(parsed.msg).toBe('test message');
    expect(parsed.data).toEqual({ foo: 'bar' });
    expect(typeof parsed.ts).toBe('number');
  });

  it('should log warn messages', () => {
    logger.warn('warning');
    const parsed = JSON.parse(logs[0]);
    expect(parsed.level).toBe('warn');
    expect(parsed.msg).toBe('warning');
  });

  it('should log error messages', () => {
    logger.error('error occurred', { code: 500 });
    const parsed = JSON.parse(logs[0]);
    expect(parsed.level).toBe('error');
    expect(parsed.msg).toBe('error occurred');
    expect(parsed.data).toEqual({ code: 500 });
  });

  it('should log debug messages when DEBUG env is set', () => {
    const oldDebug = Bun.env.DEBUG;
    Bun.env.DEBUG = 'true';
    logger.debug('debug info');
    Bun.env.DEBUG = oldDebug;
    expect(logs.length).toBe(1);
    const parsed = JSON.parse(logs[0]);
    expect(parsed.level).toBe('debug');
  });

  it('should include timestamp as number', () => {
    logger.info('test');
    const parsed = JSON.parse(logs[0]);
    expect(typeof parsed.ts).toBe('number');
    expect(parsed.ts).toBeGreaterThan(0);
  });

  it('should have data field in output', () => {
    logger.info('message with data', { key: 'value' });
    const parsed = JSON.parse(logs[0]);
    expect(parsed.data).toEqual({ key: 'value' });
  });
});
