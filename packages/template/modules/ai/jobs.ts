import { defineJob, logger } from '@vobase/core';
import { eq } from 'drizzle-orm';
import { z } from 'zod';

import { getModuleDb } from '../../mastra/lib/deps';

export { setAiModuleDeps } from '../../mastra/lib/deps';

import { runAgentEvals } from '../../mastra/evals/runner';
import { processMemCell } from '../../mastra/processors/memory/formation';
import { aiEvalRuns } from './schema';

const memoryFormationDataSchema = z.object({ cellId: z.string().min(1) });
const evalRunDataSchema = z.object({ runId: z.string().min(1) });

/**
 * ai:memory-formation — Process a MemCell: extract episode + facts, embed, store.
 * Queued by the memory output processor when a conversation boundary is detected.
 */
export const memoryFormationJob = defineJob(
  'ai:memory-formation',
  async (data) => {
    const moduleDb = getModuleDb();
    const { cellId } = memoryFormationDataSchema.parse(data);
    logger.info('[memory] Formation job started', { cellId });
    try {
      await processMemCell(moduleDb, cellId);
      logger.info('[memory] Formation job completed', { cellId });
    } catch (err) {
      logger.error('[memory] Formation job failed', { cellId, error: err });
      throw err;
    }
  },
);

/**
 * ai:eval-run — Execute eval scorers against provided data items.
 * Loads the eval run row, runs scorers, writes results back.
 */
export const evalRunJob = defineJob('ai:eval-run', async (data) => {
  const moduleDb = getModuleDb();
  const { runId } = evalRunDataSchema.parse(data);

  const run = (
    await moduleDb.select().from(aiEvalRuns).where(eq(aiEvalRuns.id, runId))
  )[0];
  if (!run || run.status !== 'pending') return;

  await moduleDb
    .update(aiEvalRuns)
    .set({ status: 'running' })
    .where(eq(aiEvalRuns.id, runId));

  try {
    const parsed = JSON.parse(run.results ?? '[]');
    const evalData: Array<{
      input: string;
      output: string;
      context: string[];
    }> = Array.isArray(parsed) ? parsed : [];

    const result = await runAgentEvals({ data: evalData });

    await moduleDb
      .update(aiEvalRuns)
      .set({
        status: 'complete',
        results: JSON.stringify(result),
        completedAt: new Date(),
      })
      .where(eq(aiEvalRuns.id, runId));
  } catch (err) {
    await moduleDb
      .update(aiEvalRuns)
      .set({
        status: 'error',
        errorMessage: err instanceof Error ? err.message : 'Unknown eval error',
        completedAt: new Date(),
      })
      .where(eq(aiEvalRuns.id, runId));
  }
});
