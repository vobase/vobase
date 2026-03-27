/**
 * Shared PGlite test helper — creates instances from a cached golden image
 * to avoid running initdb per test file (PGlite 0.4+ spawns 2-3 WASM contexts
 * per initdb, causing OOM when many test files run in parallel).
 */
import { PGlite } from '@electric-sql/pglite';

let goldenDumpPromise: Promise<Blob> | null = null;

function getGoldenDump(): Promise<Blob> {
  if (!goldenDumpPromise) {
    goldenDumpPromise = (async () => {
      const seed = new PGlite();
      await seed.waitReady;
      await seed.query('CREATE SCHEMA IF NOT EXISTS "auth"');
      await seed.query('CREATE SCHEMA IF NOT EXISTS "audit"');
      await seed.query('CREATE SCHEMA IF NOT EXISTS "infra"');
      const dump = await seed.dumpDataDir('none');
      await seed.close();
      return dump;
    })();
  }
  return goldenDumpPromise;
}

/** Create a fresh PGlite instance from a cached golden image (no initdb). */
export async function createTestPGlite(): Promise<PGlite> {
  const dump = await getGoldenDump();
  for (let attempt = 0; attempt < 3; attempt++) {
    let pg: PGlite | null = null;
    try {
      pg = new PGlite({ loadDataDir: dump });
      // Attach error handler immediately to prevent unhandled rejection
      pg.waitReady.catch(() => {});
      await pg.waitReady;
      // Verify the instance is functional
      await pg.query('SELECT 1');
      return pg;
    } catch {
      // Close the failed instance if it was partially created
      try { await pg?.close(); } catch {}
      if (attempt === 2) throw new Error('PGlite failed to initialize after 3 attempts');
      await new Promise((r) => setTimeout(r, 200 * (attempt + 1)));
    }
  }
  throw new Error('unreachable');
}
