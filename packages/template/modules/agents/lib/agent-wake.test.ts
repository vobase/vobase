import { describe, expect, it } from 'bun:test';

import { iterationGuard } from './agent-wake';

describe('iterationGuard', () => {
  it('returns undefined for iterations below 15', () => {
    expect(iterationGuard({ iteration: 1 })).toBeUndefined();
    expect(iterationGuard({ iteration: 10 })).toBeUndefined();
    expect(iterationGuard({ iteration: 14 })).toBeUndefined();
  });

  it('returns feedback at iteration 15', () => {
    const result = iterationGuard({ iteration: 15 });
    expect(result).toBeDefined();
    expect(result?.feedback).toContain('wrap up');
  });

  it('returns feedback at iteration 20', () => {
    const result = iterationGuard({ iteration: 20 });
    expect(result).toBeDefined();
    expect(result?.feedback).toContain('wrap up');
  });
});
