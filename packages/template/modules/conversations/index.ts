import type { MessageReceivedEvent } from '@vobase/core';
import { defineModule, logger } from '@vobase/core';

import { conversationsRoutes } from './handlers';
import {
  channelReplyJob,
  consultationTimeoutJob,
  sendJob,
  sessionCleanupJob,
} from './jobs';
import { registerHandlers } from './lib/chat-handlers';
import { getChat, initChat } from './lib/chat-init';
import { setConversationsDeps } from './lib/deps';
import * as schema from './schema';

export const conversationsModule = defineModule({
  name: 'conversations',
  schema,
  routes: conversationsRoutes,
  jobs: [sendJob, channelReplyJob, consultationTimeoutJob, sessionCleanupJob],

  init(ctx) {
    // Wire module-level deps for jobs and lib functions
    setConversationsDeps({
      db: ctx.db,
      scheduler: ctx.scheduler,
      channels: ctx.channels,
    });

    const deps = {
      db: ctx.db,
      scheduler: ctx.scheduler,
      channels: ctx.channels,
    };

    // Initialize chat-sdk with bridge adapters and state-pg
    initChat(deps)
      .then((chat) => {
        // Register chat-sdk handlers (replaces routeInboundMessage pipeline)
        registerHandlers(chat, deps);

        // Bridge core channel events to chat-sdk
        let hasChannels = false;
        try {
          hasChannels = typeof ctx.channels.on === 'function';
        } catch {
          hasChannels = false;
        }

        if (hasChannels) {
          ctx.channels.on('message_received', (event: MessageReceivedEvent) => {
            try {
              const adapterName = event.channel;
              const adapter = (
                chat as unknown as { adapters: Record<string, unknown> }
              ).adapters[adapterName];

              if (!adapter) {
                logger.warn('[conversations] No bridge adapter for channel', {
                  channel: adapterName,
                });
                return;
              }

              // Parse raw event to chat-sdk Message, then dispatch
              const bridgeAdapter = adapter as {
                parseMessage: (raw: unknown) => unknown;
              };
              const message = bridgeAdapter.parseMessage(event);

              // processMessage is fire-and-forget (returns void)
              // Handler errors are observable via bridged logger
              chat.processMessage(
                adapter as never,
                event.from,
                message as never,
              );
            } catch (err) {
              logger.error('[conversations] Failed to feed event to chat', {
                event: { channel: event.channel, from: event.from },
                error: err,
              });
            }
          });
        }
      })
      .catch((err: unknown) => {
        logger.error('[conversations] Failed to initialize chat', {
          error: err,
        });
      });

    // Schedule recurring jobs
    ctx.scheduler
      .add(
        'conversations:consultation-timeout',
        {},
        {
          singletonKey: 'conversations:consultation-timeout',
        },
      )
      .catch(() => {
        // Ignore — job may already be registered
      });

    ctx.scheduler
      .add(
        'conversations:session-cleanup',
        {},
        {
          singletonKey: 'conversations:session-cleanup',
        },
      )
      .catch(() => {
        // Ignore — job may already be registered
      });
  },
});
