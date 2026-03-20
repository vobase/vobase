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
    goldenDump = await seed.dumpDataDir('none');
    await seed.close();
  }
  return goldenDump;
}

/** Create a fresh PGlite instance from a cached golden image (no initdb). */
export async function createTestPGlite(): Promise<PGlite> {
  const dump = await getGoldenDump();
  return new PGlite({ loadDataDir: dump });
}
