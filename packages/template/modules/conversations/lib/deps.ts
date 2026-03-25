/**
 * Shared module-level dependencies for the conversations module.
 * Set once during module init, accessed by jobs and lib functions at runtime.
 */
import type { ChannelsService, Scheduler, VobaseDb } from '@vobase/core';

interface ConversationsDeps {
  db: VobaseDb;
  scheduler: Scheduler;
  channels: ChannelsService;
}

let moduleDeps: ConversationsDeps | undefined;

/** Called from the conversations module init hook. */
export function setConversationsDeps(deps: ConversationsDeps): void {
  moduleDeps = deps;
}

/** Get module-level deps. Throws if init hook hasn't run. */
export function getConversationsDeps(): ConversationsDeps {
  if (!moduleDeps)
    throw new Error(
      'Conversations deps not initialized — call setConversationsDeps() first',
    );
  return moduleDeps;
}
