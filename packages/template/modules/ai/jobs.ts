import type { Scheduler, VobaseDb } from '@vobase/core';
import { defineJob } from '@vobase/core';
import { z } from 'zod';

import { processMemCell } from './lib/memory/formation';

const memoryFormationDataSchema = z.object({ cellId: z.string().min(1) });

let moduleDb: VobaseDb;
let moduleScheduler: Scheduler;

/** Called from the ai module init hook to wire up dependencies. */
export function setAiModuleDeps(db: VobaseDb, scheduler: Scheduler) {
  moduleDb = db;
  moduleScheduler = scheduler;
}

/**
 * ai:memory-formation — Process a MemCell: extract episode + facts, embed, store.
 * Queued by the memory output processor when a conversation boundary is detected.
 */
export const memoryFormationJob = defineJob(
  'ai:memory-formation',
  async (data) => {
    if (!moduleDb) throw new Error('moduleDb not initialized');
    const { cellId } = memoryFormationDataSchema.parse(data);
    await processMemCell(moduleDb, cellId);
  },
);
