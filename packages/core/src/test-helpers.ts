/**
 * Shared PGlite test helper — creates instances from a cached golden image
 * to avoid running initdb per test file (PGlite 0.4+ spawns 2-3 WASM contexts
 * per initdb, causing OOM when many test files run in parallel).
 */
import { PGlite } from '@electric-sql/pglite';

let goldenDump: Blob | null = null;

async function getGoldenDump(): Promise<Blob> {
  if (!goldenDump) {
    const seed = new PGlite();
    await seed.waitReady;
    // Pre-create schemas used by core modules so drizzle-kit push / raw DDL works
    await seed.query('CREATE SCHEMA IF NOT EXISTS "auth"');
    await seed.query('CREATE SCHEMA IF NOT EXISTS "audit"');
    await seed.query('CREATE SCHEMA IF NOT EXISTS "infra"');
    goldenDump = await seed.dumpDataDir('none');
    await seed.close();
  }
  return goldenDump;
}

/** Create a fresh PGlite instance from a cached golden image (no initdb). */
export async function createTestPGlite(): Promise<PGlite> {
  const dump = await getGoldenDump();
  // Retry on transient WASM initialization failures under parallel test load
  for (let attempt = 0; attempt < 3; attempt++) {
    try {
      const pg = new PGlite({ loadDataDir: dump });
      await pg.waitReady;
      return pg;
    } catch {
      if (attempt === 2) throw new Error('PGlite failed to initialize after 3 attempts');
      await new Promise((r) => setTimeout(r, 100 * (attempt + 1)));
    }
  }
  throw new Error('unreachable');
}
