import type { MessageReceivedEvent, ProvisionChannelData, ReactionEvent, StatusUpdateEvent } from '@vobase/core'
import { createNanoid, createWhatsAppAdapter, defineModule, logger } from '@vobase/core'
import { and, eq } from 'drizzle-orm'

import { messagingRoutes } from './handlers'
import { buildManagedTransport } from './handlers/channels'
import {
  automationAdvanceChasersJob,
  automationEvaluateDateRelativeJob,
  automationEvaluateRecurringJob,
  automationExecuteStepJob,
  automationRescheduleCheckJob,
  broadcastCheckScheduledJob,
  broadcastExecuteJob,
  broadcastRetryFailedJob,
  channelHealthCheckJob,
  conversationCleanupJob,
  deliverMessageJob,
  processInboundJob,
  processMediaCaptionJob,
  resolvingTimeoutJob,
  sessionExpiryJob,
  setModuleDeps,
} from './jobs'
import { setResolverContext } from './lib/audience-resolvers'
import { handleInboundMessage } from './lib/inbound'
import { handleReaction, handleStatusUpdate } from './lib/status'
import * as schema from './schema'
import { channelInstances } from './schema'

export const messagingModule = defineModule({
  name: 'messaging',
  schema,
  routes: messagingRoutes,
  jobs: [
    deliverMessageJob,
    conversationCleanupJob,
    resolvingTimeoutJob,
    processInboundJob,
    processMediaCaptionJob,
    sessionExpiryJob,
    channelHealthCheckJob,
    broadcastExecuteJob,
    broadcastCheckScheduledJob,
    broadcastRetryFailedJob,
    automationEvaluateRecurringJob,
    automationEvaluateDateRelativeJob,
    automationAdvanceChasersJob,
    automationExecuteStepJob,
    automationRescheduleCheckJob,
  ],

  async init(ctx) {
    const deps = {
      db: ctx.db,
      scheduler: ctx.scheduler,
      channels: ctx.channels,
      realtime: ctx.realtime,
      storage: ctx.storage,
    }

    setModuleDeps(deps)

    // Audience resolvers — projects can register custom audience-resolver
    // functions keyed by name; rules reference them via
    // `audienceResolverName`. Register resolvers from your app's module init
    // (after this one) via `registerAudienceResolver(name, fn)`. The engine
    // passes this init context to each resolver at evaluation time.
    setResolverContext(ctx)

    // Register channel provisioning handler (called by platform routes)
    const generateId = createNanoid()
    ctx.channels.onProvision(async (data: ProvisionChannelData) => {
      // Dedup: reuse existing active instance for same type + source
      const [existing] = await ctx.db
        .select()
        .from(channelInstances)
        .where(
          and(
            eq(channelInstances.type, data.type),
            eq(channelInstances.source, data.source),
            eq(channelInstances.status, 'active'),
          ),
        )
        .limit(1)

      let instanceId: string
      if (existing) {
        instanceId = existing.id
        await ctx.db
          .update(channelInstances)
          .set({
            label: data.label,
            integrationId: data.integrationId ?? existing.integrationId,
            config: data.config ?? existing.config,
          })
          .where(eq(channelInstances.id, instanceId))
        logger.info('[messaging] Reused existing channel instance on provision', {
          instanceId,
          type: data.type,
        })
      } else {
        instanceId = generateId()
        await ctx.db.insert(channelInstances).values({
          id: instanceId,
          type: data.type,
          label: data.label,
          source: data.source,
          integrationId: data.integrationId ?? null,
          config: data.config ?? {},
          status: 'active',
        })
      }

      // Hot-register the channel adapter from platform-stored credentials
      if (data.type === 'whatsapp') {
        const integration = await ctx.integrations.getActive('whatsapp')
        if (integration) {
          const cfg = integration.config as Record<string, unknown>
          const phoneNumberId = cfg.phoneNumberId as string | undefined
          const accessToken = cfg.accessToken as string | undefined
          const appSecret = cfg.appSecret as string | undefined
          if (!phoneNumberId || !accessToken || !appSecret) {
            logger.warn('[messaging] WhatsApp integration missing required config fields')
          } else {
            // Store phoneNumberId on instance config so inbound webhook routing can
            // resolve the Meta phone_number_id to this channel instance
            const existingConfig = (
              await ctx.db
                .select({ config: channelInstances.config })
                .from(channelInstances)
                .where(eq(channelInstances.id, instanceId))
            )[0]?.config as Record<string, unknown> | null

            if (!existingConfig?.phoneNumberId) {
              await ctx.db
                .update(channelInstances)
                .set({
                  config: { ...(existingConfig ?? {}), phoneNumberId },
                })
                .where(eq(channelInstances.id, instanceId))
            }

            ctx.channels.registerAdapter('whatsapp', createWhatsAppAdapter({ phoneNumberId, accessToken, appSecret }))
          }
        }
      }

      return { instanceId }
    })

    // Auto-create default web channel_instance if none exists
    try {
      const existing = await ctx.db.select().from(channelInstances).where(eq(channelInstances.type, 'web'))

      if (existing.length === 0) {
        await ctx.db.insert(channelInstances).values({
          type: 'web',
          label: 'Web Chat',
          source: 'env',
          status: 'active',
        })
        logger.info('[messaging] Auto-created default web channel instance')
      }
    } catch (err) {
      logger.warn('[messaging] Failed to auto-create web channel instance', {
        error: err,
      })
    }

    // Auto-register proxy adapters for shared platform channels
    const platformUrl = process.env.PLATFORM_URL
    const hmacSecret = process.env.PLATFORM_HMAC_SECRET

    if (!platformUrl || !hmacSecret) {
      logger.warn(
        '[messaging] PLATFORM_URL or PLATFORM_HMAC_SECRET not set — skipping managed channel adapter registration',
      )
    } else {
      try {
        const sharedInstances = await ctx.db
          .select()
          .from(channelInstances)
          .where(and(eq(channelInstances.source, 'platform'), eq(channelInstances.status, 'active')))

        const tenantId = process.env.PLATFORM_TENANT_ID ?? ''
        let registeredCount = 0

        for (const instance of sharedInstances) {
          const cfg = instance.config as Record<string, unknown>
          if (!cfg?.managed || typeof cfg.managedChannelId !== 'string') continue

          const managedChannelId = cfg.managedChannelId
          const phoneNumberId = (cfg.phoneNumberId as string) ?? ''

          ctx.channels.registerAdapter(
            instance.id,
            createWhatsAppAdapter({
              phoneNumberId,
              accessToken: '',
              appSecret: '',
              transport: buildManagedTransport(platformUrl, hmacSecret, tenantId, managedChannelId),
            }),
          )
          registeredCount++
        }

        if (registeredCount > 0) {
          logger.info('[messaging] Registered managed channel proxy adapters', {
            count: registeredCount,
          })
        }
      } catch (err) {
        logger.warn('[messaging] Failed to register managed channel adapters', {
          error: err,
        })
      }
    }

    // Log init complete with active channel instance count
    try {
      const allInstances = await ctx.db
        .select({ id: channelInstances.id })
        .from(channelInstances)
        .where(eq(channelInstances.status, 'active'))
      logger.info('[messaging] Init complete', {
        channelInstances: allInstances.length,
      })
    } catch {
      // Non-critical — don't block init on logging
    }

    // Wire core channel events directly to handleInboundMessage
    let hasChannels = false
    try {
      hasChannels = typeof ctx.channels.on === 'function'
    } catch {
      hasChannels = false
    }

    if (hasChannels) {
      ctx.channels.on('message_received', (event: MessageReceivedEvent) => {
        handleInboundMessage(deps, event).catch((err) => {
          logger.error('[messaging] handleInboundMessage failed — scheduling retry', {
            from: event.from,
            channel: event.channel,
            error: err,
          })
          ctx.scheduler.add('messaging:process-inbound', { event }).catch((schedErr) => {
            logger.error('[messaging] Failed to schedule inbound retry', {
              error: schedErr,
            })
          })
        })
      })

      ctx.channels.on('status_update', (event: StatusUpdateEvent) => {
        handleStatusUpdate(event).catch((err) => {
          logger.error('[messaging] handleStatusUpdate failed', {
            messageId: event.messageId,
            channel: event.channel,
            error: err,
          })
        })
      })

      ctx.channels.on('reaction', (event: ReactionEvent) => {
        handleReaction(event).catch((err) => {
          logger.error('[messaging] handleReaction failed', {
            messageId: event.messageId,
            channel: event.channel,
            error: err,
          })
        })
      })
    }

    // Schedule recurring jobs
    await scheduleRecurringJobs(ctx.scheduler)
  },
})

async function scheduleRecurringJobs(
  scheduler: Parameters<NonNullable<Parameters<typeof defineModule>[0]['init']>>[0]['scheduler'],
): Promise<void> {
  await scheduler
    .add('messaging:conversation-cleanup', {}, { singletonKey: 'messaging:conversation-cleanup' })
    .catch(() => {
      // Ignore — job may already be registered
    })

  await scheduler.add('messaging:resolving-timeout', {}, { singletonKey: 'messaging:resolving-timeout' }).catch(() => {
    // Ignore — job may already be registered
  })

  await scheduler.add('messaging:session-expiry', {}, { singletonKey: 'messaging:session-expiry' }).catch(() => {
    // Ignore — job may already be registered
  })

  await scheduler.schedule('messaging:channel-health-check', '0 */6 * * *', {}).catch(() => {
    // Ignore — schedule may already exist
  })

  await scheduler.schedule('broadcast:check-scheduled', '* * * * *', {}).catch(() => {
    // Ignore — schedule may already exist
  })

  await scheduler.schedule('automation:evaluate-recurring', '* * * * *', {}).catch(() => {
    // Ignore — schedule may already exist
  })

  await scheduler.schedule('automation:evaluate-date-relative', '* * * * *', {}).catch(() => {
    // Ignore — schedule may already exist
  })

  await scheduler.schedule('automation:advance-chasers', '*/5 * * * *', {}).catch(() => {
    // Ignore — schedule may already exist
  })

  await scheduler.schedule('automation:reschedule-check', '0 * * * *', {}).catch(() => {
    // Ignore — schedule may already exist
  })
}
