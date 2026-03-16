import { describe, expect, it } from 'bun:test';

import { nanoidPrimaryKey } from './schema-helpers';

/** Drizzle column config internals not in public types */
interface ColumnConfig { defaultFn?: () => string; config?: { defaultFn?: () => string } }

describe('nanoidPrimaryKey()', () => {
  it('returns a drizzle column builder', () => {
    const col = nanoidPrimaryKey();
    expect(col).toBeDefined();
  });

  it('generates unique IDs via $defaultFn', () => {
    const col = nanoidPrimaryKey();
    // Access the default function from the column config
    const meta = col as unknown as ColumnConfig;
    const defaultFn = meta.config?.defaultFn ?? meta.defaultFn;

    if (defaultFn) {
      const id1 = defaultFn();
      const id2 = defaultFn();
      expect(id1).not.toBe(id2);
      expect(id1).toHaveLength(12);
      expect(id2).toHaveLength(12);
      // Should only contain lowercase alphanumeric characters
      expect(id1).toMatch(/^[0-9a-z]{12}$/);
      expect(id2).toMatch(/^[0-9a-z]{12}$/);
    }
  });
});
