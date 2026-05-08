import {
  createNanoid,
  createWhatsAppAdapter,
  getCtx,
  logger,
  notFound,
  unauthorized,
  validation,
  verifyHmacSignature,
} from '@vobase/core'
import type { Context } from 'hono'
import { Hono } from 'hono'
import { z } from 'zod'

import { channelInstances } from '../messaging/schema'

const generateId = createNanoid()

const configureSchema = z.object({
  config: z.object({
    accessToken: z.string().min(1),
    phoneNumberId: z.string().min(1),
    wabaId: z.string().min(1),
    apiVersion: z.string().optional(),
    appSecret: z.string().min(1),
  }),
  label: z.string().min(1),
})

const provisionSchema = z.object({
  type: z.string().min(1),
  label: z.string().min(1),
  source: z.enum(['env', 'self', 'platform', 'sandbox']).optional().default('platform'),
})

const integrationConfigSchema = z.object({
  accessToken: z.string().min(1),
  phoneNumberId: z.string().min(1),
  wabaId: z.string().min(1),
  appSecret: z.string().min(1),
})

/**
 * Read the raw request body and verify the platform's HMAC signature.
 * The platform signs the JSON body string with PLATFORM_HMAC_SECRET and
 * sends the signature in the X-Platform-Signature header.
 */
async function verifyPlatformSignature(c: Context): Promise<string> {
  const secret = process.env.PLATFORM_HMAC_SECRET
  if (!secret) {
    logger.warn('[integrations] PLATFORM_HMAC_SECRET not configured — rejecting platform request')
    throw unauthorized()
  }
  const sig = c.req.header('X-Platform-Signature')
  if (!sig) throw unauthorized()
  const raw = await c.req.text()
  if (!verifyHmacSignature(raw, sig, secret)) {
    logger.warn('[integrations] HMAC verification failed', { path: c.req.path })
    throw unauthorized()
  }
  return raw
}

export const integrationsRoutes = new Hono()
  /**
   * Forwarded by the platform after Embedded Signup. Stores the System User Access
   * Token and related identifiers in this tenant's integrations vault.
   */
  .post('/whatsapp/configure', async (c) => {
    const raw = await verifyPlatformSignature(c)
    const body = configureSchema.parse(JSON.parse(raw))
    const { integrations } = getCtx(c)

    const integration = await integrations.connect(
      'whatsapp',
      {
        accessToken: body.config.accessToken,
        phoneNumberId: body.config.phoneNumberId,
        wabaId: body.config.wabaId,
        appSecret: body.config.appSecret,
      },
      {
        authType: 'embedded_signup',
        scopes: ['whatsapp_business_management', 'whatsapp_business_messaging'],
      },
    )

    logger.info('[integrations] platform-managed WhatsApp credentials stored', {
      integrationId: integration.id,
      label: body.label,
    })

    return c.json({ success: true, integrationId: integration.id })
  })

  /**
   * Forwarded by the platform after /whatsapp/configure. Creates the channel_instance
   * row that pairs the freshly stored credentials with a routing target, and hot-registers
   * the WhatsApp adapter so inbound webhooks from Meta resolve without a server restart.
   */
  .post('/provision-channel', async (c) => {
    const raw = await verifyPlatformSignature(c)
    const body = provisionSchema.parse(JSON.parse(raw))
    const ctx = getCtx(c)

    if (body.type !== 'whatsapp') {
      throw validation({ type: `Unsupported channel type '${body.type}'` })
    }

    const integration = await ctx.integrations.getActive('whatsapp')
    if (!integration) {
      throw notFound('whatsapp integration')
    }
    const cfg = integrationConfigSchema.parse(integration.config)

    const instanceId = generateId()
    await ctx.db.insert(channelInstances).values({
      id: instanceId,
      type: body.type,
      source: body.source,
      integrationId: integration.id,
      label: body.label,
      status: 'active',
      config: {
        source: 'platform',
        phoneNumberId: cfg.phoneNumberId,
        wabaId: cfg.wabaId,
      },
    })

    ctx.channels.registerAdapter(
      'whatsapp',
      createWhatsAppAdapter({
        phoneNumberId: cfg.phoneNumberId,
        accessToken: cfg.accessToken,
        appSecret: cfg.appSecret,
      }),
    )

    logger.info('[integrations] platform-managed channel instance provisioned', {
      instanceId,
      integrationId: integration.id,
      label: body.label,
    })

    return c.json({ instanceId })
  })
