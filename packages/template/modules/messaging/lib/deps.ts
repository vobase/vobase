import type {
  ChannelsService,
  RealtimeService,
  Scheduler,
  StorageService,
  VobaseDb,
} from '@vobase/core';

export interface ModuleDeps {
  db: VobaseDb;
  scheduler: Scheduler;
  channels: ChannelsService;
  realtime: RealtimeService;
  storage?: StorageService;
}

/**
 * Module-level singleton deps — used by jobs, cron handlers, and init hooks
 * where no Mastra RequestContext is available.
 *
 * Mastra tools MUST read deps from `context.requestContext.get('deps')` instead.
 * Agent invocation sites (agent-wake job) set deps on the RequestContext
 * before calling the agent.
 */
let moduleDeps: ModuleDeps | undefined;

export function setModuleDeps(deps: ModuleDeps): void {
  moduleDeps = deps;
}

export function getModuleDeps(): ModuleDeps {
  if (!moduleDeps)
    throw new Error('Module deps not initialized — call setModuleDeps() first');
  return moduleDeps;
}
