import type {
  ChannelsService,
  RealtimeService,
  Scheduler,
  VobaseDb,
} from '@vobase/core';

export interface ModuleDeps {
  db: VobaseDb;
  scheduler: Scheduler;
  channels: ChannelsService;
  realtime: RealtimeService;
}

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

function getModuleChannelsOrNull(): ChannelsService | undefined {
  return moduleDeps?.channels;
}

export function getModuleRealtimeOrNull(): RealtimeService | undefined {
  return moduleDeps?.realtime;
}
