import { describe, expect, it } from 'bun:test';

import { computeTab } from './activity-events';

describe('computeTab', () => {
  it('returns "done" for resolved conversations', () => {
    expect(computeTab('resolved', false)).toBe('done');
    expect(computeTab('resolved', true)).toBe('done');
  });

  it('returns "done" for failed conversations', () => {
    expect(computeTab('failed', false)).toBe('done');
  });

  it('returns "on-hold" when onHold is true', () => {
    expect(computeTab('active', true)).toBe('on-hold');
  });

  it('returns "active" for active non-held conversations', () => {
    expect(computeTab('active', false)).toBe('active');
  });
});
