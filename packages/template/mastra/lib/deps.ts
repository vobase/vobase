import type {
  ChannelsService,
  RealtimeService,
  Scheduler,
  VobaseDb,
} from '@vobase/core';

let moduleDb: VobaseDb | undefined;
let moduleScheduler: Scheduler | undefined;
let moduleChannels: ChannelsService | undefined;
let moduleRealtime: RealtimeService | undefined;

export function setAiModuleDeps(
  db: VobaseDb,
  scheduler: Scheduler,
  channels: ChannelsService,
  realtime?: RealtimeService,
) {
  moduleDb = db;
  moduleScheduler = scheduler;
  moduleChannels = channels;
  moduleRealtime = realtime;
}

export function getModuleDb(): VobaseDb {
  if (!moduleDb)
    throw new Error(
      'AI module db not initialized — call setAiModuleDeps() first',
    );
  return moduleDb;
}

export function getModuleDbOrNull(): VobaseDb | undefined {
  return moduleDb;
}

export function getModuleScheduler(): Scheduler {
  if (!moduleScheduler)
    throw new Error(
      'AI module scheduler not initialized — call setAiModuleDeps() first',
    );
  return moduleScheduler;
}

export function getModuleChannels(): ChannelsService {
  if (!moduleChannels)
    throw new Error(
      'AI module channels not initialized — call setAiModuleDeps() first',
    );
  return moduleChannels;
}

export function getModuleChannelsOrNull(): ChannelsService | undefined {
  return moduleChannels;
}

export function getModuleRealtimeOrNull(): RealtimeService | undefined {
  return moduleRealtime;
}
