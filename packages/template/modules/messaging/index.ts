import type { MessageReceivedEvent, ProvisionChannelData } from '@vobase/core';
import {
  createNanoid,
  createWhatsAppAdapter,
  defineModule,
  logger,
} from '@vobase/core';
import { and, eq } from 'drizzle-orm';

import { messagingRoutes } from './handlers';
import { buildManagedTransport } from './handlers/channels';
import {
  conversationCleanupJob,
  deliverMessageJob,
  processInboundJob,
  resolvingTimeoutJob,
  sessionExpiryJob,
  setModuleDeps,
} from './jobs';
import { handleInboundMessage } from './lib/inbound';
import * as schema from './schema';
import { channelInstances } from './schema';

export const messagingModule = defineModule({
  name: 'messaging',
  schema,
  routes: messagingRoutes,
  jobs: [
    deliverMessageJob,
    conversationCleanupJob,
    resolvingTimeoutJob,
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
              '[messaging] WhatsApp integration missing required config fields',
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
        logger.info('[messaging] Auto-created default web channel instance');
      }
    } catch (err) {
      logger.warn('[messaging] Failed to auto-create web channel instance', {
        error: err,
      });
    }

    // Auto-register proxy adapters for shared platform channels
    const platformUrl = process.env.PLATFORM_URL;
    const hmacSecret = process.env.PLATFORM_HMAC_SECRET;

    if (!platformUrl || !hmacSecret) {
      logger.warn(
        '[messaging] PLATFORM_URL or PLATFORM_HMAC_SECRET not set — skipping managed channel adapter registration',
      );
    } else {
      try {
        const sharedInstances = await ctx.db
          .select()
          .from(channelInstances)
          .where(
            and(
              eq(channelInstances.source, 'platform'),
              eq(channelInstances.status, 'active'),
            ),
          );

        const tenantId = process.env.PLATFORM_TENANT_ID ?? '';
        let registeredCount = 0;

        for (const instance of sharedInstances) {
          const cfg = instance.config as Record<string, unknown>;
          if (!cfg?.managed || typeof cfg.managedChannelId !== 'string')
            continue;

          const managedChannelId = cfg.managedChannelId;
          const phoneNumberId = (cfg.phoneNumberId as string) ?? '';

          ctx.channels.registerAdapter(
            instance.id,
            createWhatsAppAdapter({
              phoneNumberId,
              accessToken: '',
              appSecret: '',
              transport: buildManagedTransport(
                platformUrl,
                hmacSecret,
                tenantId,
                managedChannelId,
              ),
            }),
          );
          registeredCount++;
        }

        if (registeredCount > 0) {
          logger.info('[messaging] Registered managed channel proxy adapters', {
            count: registeredCount,
          });
        }
      } catch (err) {
        logger.warn('[messaging] Failed to register managed channel adapters', {
          error: err,
        });
      }
    }

    // Log init complete with active channel instance count
    try {
      const allInstances = await ctx.db
        .select({ id: channelInstances.id })
        .from(channelInstances)
        .where(eq(channelInstances.status, 'active'));
      logger.info('[messaging] Init complete', {
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
          logger.error(
            '[messaging] handleInboundMessage failed — scheduling retry',
            {
              from: event.from,
              channel: event.channel,
              error: err,
            },
          );
          ctx.scheduler
            .add('messaging:process-inbound', { event })
            .catch((schedErr) => {
              logger.error('[messaging] Failed to schedule inbound retry', {
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
      'messaging:conversation-cleanup',
      {},
      { singletonKey: 'messaging:conversation-cleanup' },
    )
    .catch(() => {
      // Ignore — job may already be registered
    });

  await scheduler
    .add(
      'messaging:resolving-timeout',
      {},
      { singletonKey: 'messaging:resolving-timeout' },
    )
    .catch(() => {
      // Ignore — job may already be registered
    });

  await scheduler
    .add(
      'messaging:session-expiry',
      {},
      { singletonKey: 'messaging:session-expiry' },
    )
    .catch(() => {
      // Ignore — job may already be registered
    });
}
