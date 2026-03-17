import { describe, expect, it } from 'bun:test';

import { nanoidPrimaryKey } from './schema-helpers';

describe('nanoidPrimaryKey()', () => {
  it('returns a drizzle column builder', () => {
    const col = nanoidPrimaryKey();
    expect(col).toBeDefined();
  });
});
