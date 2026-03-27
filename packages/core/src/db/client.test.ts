import { rmSync } from 'node:fs';
import { afterAll, describe, expect, it } from 'bun:test';
import { PGlite } from '@electric-sql/pglite';
import { sql } from 'drizzle-orm';
import { drizzle } from 'drizzle-orm/pglite';

import { createDatabase } from './client';

const tmpDir1 = `/tmp/vobase-test-client-${Date.now()}-1`;
const tmpDir2 = `/tmp/vobase-test-client-${Date.now()}-2`;

afterAll(() => {
  rmSync(tmpDir1, { recursive: true, force: true });
  rmSync(tmpDir2, { recursive: true, force: true });
});

describe('createDatabase', () => {
  it('creates a PGlite-backed drizzle instance for local paths', async () => {
    const db = createDatabase(tmpDir1);

    expect(db).toBeDefined();
  });

  it('PGlite supports basic SQL queries', async () => {
    const pglite = new PGlite();
    const db = drizzle({ client: pglite });

    const result = await db.execute(sql`SELECT 1 + 1 AS two`);
    expect(
      (result as unknown as { rows: Array<{ two: number }> }).rows[0].two,
    ).toBe(2);

    await pglite.close();
  });

  it('createDatabase returns a working Drizzle instance', async () => {
    const db = createDatabase(tmpDir2);

    // Should not throw
    expect(db).toBeDefined();
    expect(typeof db.select).toBe('function');
    expect(typeof db.insert).toBe('function');
  });
});
