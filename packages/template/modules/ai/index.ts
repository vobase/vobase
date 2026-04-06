import type { MessageReceivedEvent } from '@vobase/core';
import { defineModule, logger } from '@vobase/core';
import { eq } from 'drizzle-orm';

import { configureTracing } from '../../mastra/lib/observability';
import { aiRoutes } from './handlers';
import {
  channelReplyJob,
  consultationTimeoutJob,
  conversationCleanupJob,
  deliverMessageJob,
  evalRunJob,
  memoryFormationJob,
  processInboundJob,
  setModuleDeps,
} from './jobs';
import { registerHandlers } from './lib/chat-handlers';
import { getChat, initChat, onChatInit } from './lib/chat-init';
import * as schema from './schema';
import { channelInstances } from './schema';

export const aiModule = defineModule({
  name: 'ai',
  schema,
  routes: aiRoutes,
  jobs: [
    memoryFormationJob,
    evalRunJob,
    deliverMessageJob,
    channelReplyJob,
    consultationTimeoutJob,
    conversationCleanupJob,
    processInboundJob,
  ],

  async init(ctx) {
    const deps = {
      db: ctx.db,
      scheduler: ctx.scheduler,
      channels: ctx.channels,
      realtime: ctx.realtime,
    };

    setModuleDeps(deps);
    configureTracing();

    // Auto-create default web channel_instance if none exists
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
        logger.info('[ai] Auto-created default web channel instance');
      }
    } catch (err) {
      logger.warn('[ai] Failed to auto-create web channel instance', {
        error: err,
      });
    }

    // Initialize chat-sdk with bridge adapters and state-pg
    let chat: Awaited<ReturnType<typeof initChat>>;
    try {
      chat = await initChat(deps);
    } catch (err) {
      logger.error('[ai] Failed to initialize chat', { error: err });
      await scheduleRecurringJobs(ctx.scheduler);
      return;
    }

    // Register chat-sdk handlers (and re-register on every reinit)
    registerHandlers(chat, deps);
    onChatInit((newChat) => registerHandlers(newChat, deps));

    // Log init complete with active channel instance count
    try {
      const allInstances = await ctx.db
        .select({ id: channelInstances.id })
        .from(channelInstances)
        .where(eq(channelInstances.status, 'active'));
      const chatAdapterCount = (
        chat as unknown as { adapters: Map<string, unknown> }
      ).adapters.size;
      logger.info('[ai] Init complete', {
        channelInstances: allInstances.length,
        chatAdapters: chatAdapterCount,
      });
    } catch {
      // Non-critical — don't block init on logging
    }

    // Bridge core channel events to chat-sdk
    let hasChannels = false;
    try {
      hasChannels = typeof ctx.channels.on === 'function';
    } catch {
      hasChannels = false;
    }

    if (hasChannels) {
      ctx.channels.on('message_received', (event: MessageReceivedEvent) => {
        const adapterName = event.channelInstanceId ?? event.channel;
        const currentChat = getChat();
        const chatAdapters = (
          currentChat as unknown as { adapters: Map<string, unknown> }
        ).adapters;

        try {
          const adapter = chatAdapters.get(adapterName);

          if (!adapter) {
            logger.warn('[ai] No bridge adapter for channel', {
              adapterName,
              channelInstanceId: event.channelInstanceId,
              availableAdapters: Array.from(chatAdapters.keys()),
            });
            return;
          }

          const bridgeAdapter = adapter as {
            parseMessage: (raw: unknown) => unknown;
          };
          const message = bridgeAdapter.parseMessage(event);

          Promise.resolve(
            currentChat.processMessage(
              adapter as never,
              event.from,
              message as never,
            ),
          ).catch((err) => {
            logger.error('[ai] processMessage failed — scheduling retry job', {
              adapterName,
              from: event.from,
              error: err,
            });
            ctx.scheduler
              .add('ai:process-inbound', {
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
                logger.error('[ai] Failed to schedule inbound retry', {
                  error: schedErr,
                });
              });
          });
        } catch (err) {
          logger.error('[ai] Failed to feed event to chat', {
            event: {
              channelInstanceId: event.channelInstanceId,
              channel: event.channel,
              from: event.from,
            },
            error: err,
          });

          ctx.scheduler
            .add('ai:process-inbound', {
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
              logger.error('[ai] Failed to schedule inbound retry', {
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
      'ai:consultation-timeout',
      {},
      { singletonKey: 'ai:consultation-timeout' },
    )
    .catch(() => {
      // Ignore — job may already be registered
    });

  await scheduler
    .add(
      'ai:conversation-cleanup',
      {},
      { singletonKey: 'ai:conversation-cleanup' },
    )
    .catch(() => {
      // Ignore — job may already be registered
    });
}
