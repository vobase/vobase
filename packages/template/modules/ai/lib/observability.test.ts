import { afterEach, describe, expect, test } from 'bun:test';

import { configureTracing } from './observability';

describe('configureTracing', () => {
  const originalEnv = process.env.OTEL_EXPORTER_OTLP_ENDPOINT;

  afterEach(() => {
    if (originalEnv !== undefined) {
      process.env.OTEL_EXPORTER_OTLP_ENDPOINT = originalEnv;
    } else {
      delete process.env.OTEL_EXPORTER_OTLP_ENDPOINT;
    }
  });

  test('returns enabled: false when OTEL env var is not set', () => {
    delete process.env.OTEL_EXPORTER_OTLP_ENDPOINT;
    const result = configureTracing();
    expect(result).toEqual({ enabled: false });
  });

  test('returns enabled: true when OTEL env var is set', () => {
    process.env.OTEL_EXPORTER_OTLP_ENDPOINT = 'http://localhost:4318';
    const result = configureTracing();
    expect(result).toEqual({ enabled: true });
  });
});
