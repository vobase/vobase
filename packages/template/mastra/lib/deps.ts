/**
 * Shared module-level dependencies for the AI module.
 * Set once during module init, accessed by tools, agents, and processors at runtime.
 */
import type { Scheduler, VobaseDb } from '@vobase/core';

let moduleDb: VobaseDb | undefined;
let moduleScheduler: Scheduler | undefined;

/** Called from the ai module init hook to wire up dependencies. */
export function setAiModuleDeps(db: VobaseDb, scheduler: Scheduler) {
  moduleDb = db;
  moduleScheduler = scheduler;
}

/** Get the module-level db. Throws if init hook hasn't run (e.g. in Studio context). */
export function getModuleDb(): VobaseDb {
  if (!moduleDb)
    throw new Error(
      'AI module db not initialized — call setAiModuleDeps() first',
    );
  return moduleDb;
}

/** Get the module-level db or undefined (for graceful Studio fallback). */
export function getModuleDbOrNull(): VobaseDb | undefined {
  return moduleDb;
}

/** Get the module-level scheduler. Throws if init hook hasn't run. */
export function getModuleScheduler(): Scheduler {
  if (!moduleScheduler)
    throw new Error(
      'AI module scheduler not initialized — call setAiModuleDeps() first',
    );
  return moduleScheduler;
}
