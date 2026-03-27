import type {
  ChannelsService,
  RealtimeService,
  Scheduler,
  VobaseDb,
} from '@vobase/core';

export interface ConversationsDeps {
  db: VobaseDb;
  scheduler: Scheduler;
  channels: ChannelsService;
  realtime: RealtimeService;
}

let moduleDeps: ConversationsDeps | undefined;

export function setConversationsDeps(deps: ConversationsDeps): void {
  moduleDeps = deps;
}

export function getConversationsDeps(): ConversationsDeps {
  if (!moduleDeps)
    throw new Error(
      'Conversations deps not initialized — call setConversationsDeps() first',
    );
  return moduleDeps;
}
