import type { MessageReceivedEvent, ProvisionChannelData } from '@vobase/core';
import {
  createNanoid,
  createWhatsAppAdapter,
  defineModule,
  logger,
} from '@vobase/core';
import { eq } from 'drizzle-orm';

import { configureTracing } from '../../mastra/lib/observability';
import { aiRoutes } from './handlers';
import {
  channelReplyJob,
  completingTimeoutJob,
  consultationTimeoutJob,
  conversationCleanupJob,
  deliverMessageJob,
  evalRunJob,
  processInboundJob,
  sessionExpiryJob,
  setModuleDeps,
} from './jobs';
import { handleInboundMessage } from './lib/inbound';
import * as schema from './schema';
import { channelInstances } from './schema';

export const aiModule = defineModule({
  name: 'ai',
  schema,
  routes: aiRoutes,
  jobs: [
    evalRunJob,
    deliverMessageJob,
    channelReplyJob,
    consultationTimeoutJob,
    conversationCleanupJob,
    completingTimeoutJob,
    processInboundJob,
    sessionExpiryJob,
  ],

  async init(ctx) {
    const deps = {
      db: ctx.db,
      scheduler: ctx.scheduler,
      channels: ctx.channels,
      realtime: ctx.realtime,
      storage: ctx.storage,
    };

    setModuleDeps(deps);
    configureTracing();

    // Register channel provisioning handler (called by platform routes)
    const generateId = createNanoid();
    ctx.channels.onProvision(async (data: ProvisionChannelData) => {
      const instanceId = generateId();
      await ctx.db.insert(channelInstances).values({
        id: instanceId,
        type: data.type,
        label: data.label,
        source: data.source,
        integrationId: data.integrationId ?? null,
        config: data.config ?? {},
        status: 'active',
      });

      // Hot-register the channel adapter from platform-stored credentials
      if (data.type === 'whatsapp') {
        const integration = await ctx.integrations.getActive('whatsapp');
        if (integration) {
          const cfg = integration.config as Record<string, unknown>;
          const phoneNumberId = cfg.phoneNumberId as string | undefined;
          const accessToken = cfg.accessToken as string | undefined;
          const appSecret = cfg.appSecret as string | undefined;
          if (!phoneNumberId || !accessToken || !appSecret) {
            logger.warn(
              '[ai] WhatsApp integration missing required config fields',
            );
          } else {
            ctx.channels.registerAdapter(
              'whatsapp',
              createWhatsAppAdapter({ phoneNumberId, accessToken, appSecret }),
            );
          }
        }
      }

      return { instanceId };
    });

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

    // Log init complete with active channel instance count
    try {
      const allInstances = await ctx.db
        .select({ id: channelInstances.id })
        .from(channelInstances)
        .where(eq(channelInstances.status, 'active'));
      logger.info('[ai] Init complete', {
        channelInstances: allInstances.length,
      });
    } catch {
      // Non-critical — don't block init on logging
    }

    // Wire core channel events directly to handleInboundMessage
    let hasChannels = false;
    try {
      hasChannels = typeof ctx.channels.on === 'function';
    } catch {
      hasChannels = false;
    }

    if (hasChannels) {
      ctx.channels.on('message_received', (event: MessageReceivedEvent) => {
        handleInboundMessage(deps, event).catch((err) => {
          logger.error('[ai] handleInboundMessage failed — scheduling retry', {
            from: event.from,
            channel: event.channel,
            error: err,
          });
          ctx.scheduler
            .add('ai:process-inbound', { event })
            .catch((schedErr) => {
              logger.error('[ai] Failed to schedule inbound retry', {
                error: schedErr,
              });
            });
        });
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

  await scheduler
    .add('ai:completing-timeout', {}, { singletonKey: 'ai:completing-timeout' })
    .catch(() => {
      // Ignore — job may already be registered
    });

  await scheduler
    .add('ai:session-expiry', {}, { singletonKey: 'ai:session-expiry' })
    .catch(() => {
      // Ignore — job may already be registered
    });
}
