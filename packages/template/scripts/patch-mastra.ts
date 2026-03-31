/**
 * Patch Mastra's compiled JS to fix threadId/resourceId not being passed
 * to #runScorers in the stream path (#executeOnFinish).
 *
 * Bug: The stream path calls #runScorers without threadId and resourceId,
 * even though they're available in scope. The generate() path passes them
 * correctly. This patch adds the two missing fields.
 *
 * Run: bun scripts/patch-mastra.ts
 * Idempotent — safe to run multiple times.
 */

import { Glob } from 'bun';

const MASTRA_DIST = new URL(
  '../node_modules/@mastra/core/dist/',
  import.meta.url,
).pathname;

// Pattern: the #runScorers call in #executeOnFinish that's missing threadId/resourceId.
// We match "overrideScorers,\n      ...observabilityContext" which only appears in the
// stream path (the generate path uses "...createObservabilityContext(...)" inline).
const SEARCH = 'overrideScorers,\n      ...observabilityContext';
const REPLACE =
  'overrideScorers,\n      threadId,\n      resourceId,\n      ...observabilityContext';

let patchedCount = 0;

// Scan both .js and .cjs chunk files
const glob = new Glob('chunk-*.{js,cjs}');

for await (const entry of glob.scan({ cwd: MASTRA_DIST, absolute: true })) {
  const file = Bun.file(entry);
  const content = await file.text();

  // Already patched?
  if (content.includes(REPLACE)) {
    console.log(`  ✓ Already patched: ${entry.split('/').pop()}`);
    patchedCount++;
    continue;
  }

  if (!content.includes(SEARCH)) continue;

  const patched = content.replace(SEARCH, REPLACE);
  await Bun.write(entry, patched);
  console.log(`  ✓ Patched: ${entry.split('/').pop()}`);
  patchedCount++;
}

if (patchedCount === 0) {
  console.log(
    '  ⚠ No matching files found — Mastra version may have changed. Check if the bug is fixed upstream.',
  );
} else {
  console.log(`\n  Done — patched ${patchedCount} file(s).`);
}
