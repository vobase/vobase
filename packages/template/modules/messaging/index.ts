import type { MessageReceivedEvent, StatusUpdateEvent } from '@vobase/core';
import { defineModule } from '@vobase/core';

import { messagingRoutes } from './handlers';
import {
  archiveThreadsJob,
  channelReplyJob,
  purgeMessagesJob,
  recoverStuckJob,
  resumeAiJob,
  sendMessageJob,
  setModuleDeps,
} from './jobs';
import {
  handleInboundMessage,
  handleStatusUpdate,
} from './lib/channel-handler';
import * as schema from './schema';

export const messagingModule = defineModule({
  name: 'messaging',
  schema,
  routes: messagingRoutes,
  jobs: [
    sendMessageJob,
    channelReplyJob,
    resumeAiJob,
    archiveThreadsJob,
    purgeMessagesJob,
    recoverStuckJob,
  ],

  init(ctx) {
    // Only wire channel events if channels is configured.
    // Web-only chat works without any channel adapters.
    let hasChannels = false;
    try {
      // Test if channels is a real service (not a throw proxy)
      const _ = ctx.channels.on;
      hasChannels = typeof _ === 'function';
    } catch {
      hasChannels = false;
    }

    if (hasChannels) {
      setModuleDeps(ctx.db, ctx.channels, ctx.scheduler, ctx.storage);

      const deps = {
        db: ctx.db,
        scheduler: ctx.scheduler,
        channels: ctx.channels,
        storage: ctx.storage,
      };

      ctx.channels.on('message_received', (event: MessageReceivedEvent) => {
        handleInboundMessage(deps, event);
      });

      ctx.channels.on('status_update', (event: StatusUpdateEvent) => {
        handleStatusUpdate(deps, event);
      });
    }
  },
});
