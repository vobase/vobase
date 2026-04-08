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
 * Mastra tools MUST read deps from `context.requestContext.get('deps')` instead,
 * falling back to getModuleDeps() only for safety during transition.
 * Agent invocation sites (streamChat, generateChannelReply) set deps on the
 * RequestContext before calling the agent.
 */
let moduleDeps: ModuleDeps | undefined;

export function setModuleDeps(deps: ModuleDeps): void {
  moduleDeps = deps;
}

export function getModuleDeps(): ModuleDeps {
  if (!moduleDeps)
    throw new Error(
      'AI module deps not initialized — call setModuleDeps() first',
    );
  return moduleDeps;
}

export function getModuleDb(): VobaseDb {
  if (!moduleDeps?.db)
    throw new Error(
      'AI module db not initialized — call setModuleDeps() first',
    );
  return moduleDeps.db;
}

export function getModuleDbOrNull(): VobaseDb | undefined {
  return moduleDeps?.db;
}

export function getModuleScheduler(): Scheduler {
  if (!moduleDeps?.scheduler)
    throw new Error(
      'AI module scheduler not initialized — call setModuleDeps() first',
    );
  return moduleDeps.scheduler;
}

export function getModuleChannels(): ChannelsService {
  if (!moduleDeps?.channels)
    throw new Error(
      'AI module channels not initialized — call setModuleDeps() first',
    );
  return moduleDeps.channels;
}

function _getModuleChannelsOrNull(): ChannelsService | undefined {
  return moduleDeps?.channels;
}

export function getModuleRealtimeOrNull(): RealtimeService | undefined {
  return moduleDeps?.realtime;
}
