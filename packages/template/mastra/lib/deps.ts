/**
 * Shared module-level dependencies for the AI module.
 * Set once during module init, accessed by tools, agents, and processors at runtime.
 */
import type { ChannelsService, Scheduler, VobaseDb } from '@vobase/core';

let moduleDb: VobaseDb | undefined;
let moduleScheduler: Scheduler | undefined;
let moduleChannels: ChannelsService | undefined;

/** Called from the ai module init hook to wire up dependencies. */
export function setAiModuleDeps(
  db: VobaseDb,
  scheduler: Scheduler,
  channels: ChannelsService,
) {
  moduleDb = db;
  moduleScheduler = scheduler;
  moduleChannels = channels;
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

/** Get the module-level channels service. Throws if init hook hasn't run. */
export function getModuleChannels(): ChannelsService {
  if (!moduleChannels)
    throw new Error(
      'AI module channels not initialized — call setAiModuleDeps() first',
    );
  return moduleChannels;
}

/** Get the module-level channels or undefined (for graceful fallback). */
export function getModuleChannelsOrNull(): ChannelsService | undefined {
  return moduleChannels;
}
