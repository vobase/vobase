import type { MessageReceivedEvent } from '@vobase/core';
import { defineModule, logger } from '@vobase/core';
import { eq } from 'drizzle-orm';

import { conversationsRoutes } from './handlers';
import {
  channelReplyJob,
  consultationTimeoutJob,
  conversationCleanupJob,
  processInboundJob,
  retryMemoryThreadJob,
  sendJob,
} from './jobs';
import { registerHandlers } from './lib/chat-handlers';
import { initChat } from './lib/chat-init';
import { setConversationsDeps } from './lib/deps';
import * as schema from './schema';
import { channelInstances } from './schema';

export const conversationsModule = defineModule({
  name: 'conversations',
  schema,
  routes: conversationsRoutes,
  jobs: [
    sendJob,
    channelReplyJob,
    consultationTimeoutJob,
    conversationCleanupJob,
    processInboundJob,
    retryMemoryThreadJob,
  ],

  async init(ctx) {
    const deps = {
      db: ctx.db,
      scheduler: ctx.scheduler,
      channels: ctx.channels,
      realtime: ctx.realtime,
    };

    setConversationsDeps(deps);

    // Auto-create default web channel_instance if none exists (H5: awaited)
    try {
      const existing = await ctx.db
        .select()
        .from(channelInstances)
        .where(eq(channelInstances.type, 'web'));

      if (existing.length === 0) {
        await ctx.db.insert(channelInstances).values({
          type: 'web',
          label: 'Web Chat',
          source: 'env',
          status: 'active',
        });
        logger.info(
          '[conversations] Auto-created default web channel instance',
        );
      }
    } catch (err) {
      logger.warn(
        '[conversations] Failed to auto-create web channel instance',
        { error: err },
      );
    }

    // Initialize chat-sdk with bridge adapters and state-pg (H5: awaited)
    let chat: Awaited<ReturnType<typeof initChat>>;
    try {
      chat = await initChat(deps);
    } catch (err) {
      logger.error('[conversations] Failed to initialize chat', {
        error: err,
      });
      // Schedule recurring jobs even if chat fails
      await scheduleRecurringJobs(ctx.scheduler);
      return;
    }

    // Register chat-sdk handlers (H5: after initChat completes)
    registerHandlers(chat, deps);

    // M11: Log init complete with active channel instance count
    try {
      const allInstances = await ctx.db
        .select({ id: channelInstances.id })
        .from(channelInstances)
        .where(eq(channelInstances.status, 'active'));
      const chatAdapterCount = Object.keys(
        (chat as unknown as { adapters: Record<string, unknown> }).adapters ??
          {},
      ).length;
      logger.info('[conversations] Init complete', {
        channelInstances: allInstances.length,
        chatAdapters: chatAdapterCount,
      });
    } catch {
      // Non-critical — don't block init on logging
    }

    // Bridge core channel events to chat-sdk (C1: job-based retry on failure)
    let hasChannels = false;
    try {
      hasChannels = typeof ctx.channels.on === 'function';
    } catch {
      hasChannels = false;
    }

    if (hasChannels) {
      ctx.channels.on('message_received', (event: MessageReceivedEvent) => {
        const adapterName = event.channelInstanceId ?? event.channel;

        try {
          const adapter = (
            chat as unknown as { adapters: Record<string, unknown> }
          ).adapters[adapterName];

          if (!adapter) {
            logger.warn('[conversations] No bridge adapter for channel', {
              adapterName,
              channelInstanceId: event.channelInstanceId,
            });
            return;
          }

          const bridgeAdapter = adapter as {
            parseMessage: (raw: unknown) => unknown;
          };
          const message = bridgeAdapter.parseMessage(event);

          // Wrap processMessage to catch async failures and schedule retry job (C1)
          Promise.resolve(
            chat.processMessage(adapter as never, event.from, message as never),
          ).catch((err) => {
            logger.error(
              '[conversations] processMessage failed — scheduling retry job',
              {
                adapterName,
                from: event.from,
                error: err,
              },
            );
            ctx.scheduler
              .add('conversations:process-inbound', {
                event: {
                  channelInstanceId: event.channelInstanceId,
                  channel: event.channel,
                  from: event.from,
                  content: event.content,
                  profileName: event.profileName,
                  timestamp: event.timestamp,
                },
                adapterName,
              })
              .catch((schedErr) => {
                logger.error(
                  '[conversations] Failed to schedule inbound retry',
                  { error: schedErr },
                );
              });
          });
        } catch (err) {
          logger.error('[conversations] Failed to feed event to chat', {
            event: {
              channelInstanceId: event.channelInstanceId,
              channel: event.channel,
              from: event.from,
            },
            error: err,
          });

          // Schedule retry job for synchronous failures too (C1)
          ctx.scheduler
            .add('conversations:process-inbound', {
              event: {
                channelInstanceId: event.channelInstanceId,
                channel: event.channel,
                from: event.from,
                content: event.content,
                profileName: event.profileName,
                timestamp: event.timestamp,
              },
              adapterName,
            })
            .catch((schedErr) => {
              logger.error('[conversations] Failed to schedule inbound retry', {
                error: schedErr,
              });
            });
        }
      });
    }

    // Schedule recurring jobs
    await scheduleRecurringJobs(ctx.scheduler);
  },
});

async function scheduleRecurringJobs(
  scheduler: Parameters<
    NonNullable<Parameters<typeof defineModule>[0]['init']>
  >[0]['scheduler'],
): Promise<void> {
  await scheduler
    .add(
      'conversations:consultation-timeout',
      {},
      { singletonKey: 'conversations:consultation-timeout' },
    )
    .catch(() => {
      // Ignore — job may already be registered
    });

  await scheduler
    .add(
      'conversations:conversation-cleanup',
      {},
      { singletonKey: 'conversations:conversation-cleanup' },
    )
    .catch(() => {
      // Ignore — job may already be registered
    });
}
