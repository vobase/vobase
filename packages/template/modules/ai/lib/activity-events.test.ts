import { describe, expect, it } from 'bun:test';

import { computeTab } from './activity-events';

describe('computeTab', () => {
  it('returns "done" for resolved interactions', () => {
    expect(computeTab('ai', 'resolved', false)).toBe('done');
    expect(computeTab('human', 'resolved', true)).toBe('done');
  });

  it('returns "attention" for failed interactions', () => {
    expect(computeTab('ai', 'failed', false)).toBe('attention');
  });

  it('returns "attention" when hasPendingEscalation', () => {
    expect(computeTab('ai', 'active', true)).toBe('attention');
  });

  it('returns "attention" for human/supervised/held modes', () => {
    expect(computeTab('human', 'active', false)).toBe('attention');
    expect(computeTab('supervised', 'active', false)).toBe('attention');
    expect(computeTab('held', 'active', false)).toBe('attention');
  });

  it('returns "ai" for ai mode active interactions', () => {
    expect(computeTab('ai', 'active', false)).toBe('ai');
  });
});
