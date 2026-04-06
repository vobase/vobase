import { describe, expect, it } from 'bun:test';

import { computeTab } from './activity-events';

describe('computeTab', () => {
  it('returns "done" for completed conversations', () => {
    expect(computeTab('ai', 'completed', false)).toBe('done');
    expect(computeTab('human', 'completed', true)).toBe('done');
  });

  it('returns "attention" for failed conversations', () => {
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

  it('returns "ai" for ai mode active conversations', () => {
    expect(computeTab('ai', 'active', false)).toBe('ai');
  });
});
