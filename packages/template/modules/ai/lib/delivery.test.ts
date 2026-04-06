import { describe, expect, it } from 'bun:test';

import {
  isCircuitOpen,
  recordCircuitFailure,
  recordCircuitSuccess,
  resetCircuit,
} from './delivery';

// Use a unique channel key per test group to avoid cross-test state
const ch = (suffix: string) => `test-circuit-${suffix}`;

describe('circuit breaker', () => {
  it('circuit starts closed', () => {
    const key = ch('start');
    expect(isCircuitOpen(key)).toBe(false);
  });

  it('recordCircuitFailure opens circuit after 5 failures', () => {
    const key = ch('open');
    resetCircuit(key);

    for (let i = 0; i < 4; i++) {
      recordCircuitFailure(key);
      expect(isCircuitOpen(key)).toBe(false);
    }

    recordCircuitFailure(key); // 5th failure
    expect(isCircuitOpen(key)).toBe(true);
  });

  it('recordCircuitSuccess resets failures', () => {
    const key = ch('success');
    resetCircuit(key);

    for (let i = 0; i < 4; i++) {
      recordCircuitFailure(key);
    }

    recordCircuitSuccess(key);
    expect(isCircuitOpen(key)).toBe(false);

    // After reset, need another 5 failures to open
    for (let i = 0; i < 4; i++) {
      recordCircuitFailure(key);
    }
    expect(isCircuitOpen(key)).toBe(false);

    recordCircuitFailure(key);
    expect(isCircuitOpen(key)).toBe(true);
  });

  it('resetCircuit clears state', () => {
    const key = ch('reset');

    for (let i = 0; i < 5; i++) {
      recordCircuitFailure(key);
    }
    expect(isCircuitOpen(key)).toBe(true);

    resetCircuit(key);
    expect(isCircuitOpen(key)).toBe(false);
  });

  it('isCircuitOpen returns false after timeout (60s)', () => {
    const key = ch('timeout');
    resetCircuit(key);

    for (let i = 0; i < 5; i++) {
      recordCircuitFailure(key);
    }
    expect(isCircuitOpen(key)).toBe(true);

    // Mock Date.now to be 61s in the future
    const origNow = Date.now;
    try {
      Date.now = () => origNow() + 61_000;
      expect(isCircuitOpen(key)).toBe(false);
    } finally {
      Date.now = origNow;
    }
  });
});
