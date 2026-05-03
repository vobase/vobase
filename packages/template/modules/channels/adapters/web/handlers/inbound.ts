import { verifyHmacWebhook } from '@auth/middleware'
import { getInstance as getChannelInstance } from '@modules/channels/service/instances'
import { requireJobs } from '@modules/channels/service/state'
import { upsertByExternal } from '@modules/contacts/service/contacts'
import { createInboundMessage } from '@modules/messaging/service/conversations'
import type { Context } from 'hono'

import { type ChannelInboundEvent, ChannelInboundEventSchema } from '~/runtime/channel-events'
import { AGENTS_WAKE_JOB } from '~/wake/inbound'
import { BrowserInboundBodySchema, getSessionFromRequest, type SessionLike } from '../service/inbound-auth'
import { getInstanceDefaultAssignee } from '../service/instances'

function resolveWebhookSecret(): string {
  const configured = process.env.CHANNEL_WEB_WEBHOOK_SECRET
  if (configured) return configured
  if (process.env.NODE_ENV === 'production') {
    throw new Error('CHANNEL_WEB_WEBHOOK_SECRET must be set in production')
  }
  return 'dev-secret'
}

interface InboundInput {
  organizationId: string
  channelInstanceId: string
  from: string
  displayName: string | undefined
  content: string
  contentType: ChannelInboundEvent['contentType']
  externalMessageId: string
  profileName: string
}

async function dispatchInbound(c: Context, input: InboundInput): Promise<Response> {
  const contact = await upsertByExternal({
    organizationId: input.organizationId,
    phone: `web:${input.from}`,
    displayName: input.displayName,
  })

  const defaultAssignee = await getInstanceDefaultAssignee(input.channelInstanceId)

  const result = await createInboundMessage({
    organizationId: input.organizationId,
    channelInstanceId: input.channelInstanceId,
    contactId: contact.id,
    externalMessageId: input.externalMessageId,
    content: input.content,
    contentType: input.contentType,
    profileName: input.profileName,
    initialAssignee: defaultAssignee,
  })

  if (result.isNew) {
    await requireJobs().send(AGENTS_WAKE_JOB, {
      organizationId: input.organizationId,
      conversationId: result.conversation.id,
      messageId: result.message.id,
      contactId: contact.id,
    })
  }

  return c.json({
    received: true,
    conversationId: result.conversation.id,
    messageId: result.message.id,
    deduplicated: !result.isNew,
  })
}

async function handleSessionInbound(c: Context, session: SessionLike, channelInstanceId: string): Promise<Response> {
  let raw: unknown
  try {
    // TODO(slice-N+1): wire web-channel multipart for inbound attachments
    // (`createInboundMessage`'s `attachments[]` seam is in place; web is
    // JSON-only today). Tracked via the drive-upload-ocr-extraction plan
    // Open Question #1.
    raw = await c.req.json()
  } catch {
    return c.json({ error: 'invalid json' }, 400)
  }
  const parsed = BrowserInboundBodySchema.safeParse(raw)
  if (!parsed.success) {
    return c.json({ error: 'invalid payload', issues: parsed.error.issues }, 422)
  }

  // Anonymous widget sessions don't carry an active org — the channel instance
  // is the source of truth for which org owns this inbound message.
  let organizationId = session.session.activeOrganizationId
  if (!organizationId) {
    const instance = await getChannelInstance(channelInstanceId)
    if (!instance) return c.json({ error: 'unknown channel instance' }, 404)
    organizationId = instance.organizationId
  }

  const body = parsed.data
  return dispatchInbound(c, {
    organizationId,
    channelInstanceId,
    from: session.user.id,
    displayName: body.profileName || session.user.name || undefined,
    content: body.content,
    contentType: body.contentType,
    externalMessageId: body.externalMessageId,
    profileName: body.profileName ?? session.user.name ?? '',
  })
}

async function handleHmacInbound(c: Context, channelInstanceId: string): Promise<Response> {
  const v = await verifyHmacWebhook(c, {
    secret: (ctx) => ctx.req.header('x-channel-secret') ?? resolveWebhookSecret(),
  })
  if (!v.ok) return v.response

  const parsed = ChannelInboundEventSchema.safeParse(v.payload)
  if (!parsed.success) {
    return c.json({ error: 'invalid payload', issues: parsed.error.issues }, 422)
  }

  const event = parsed.data
  return dispatchInbound(c, {
    organizationId: event.organizationId,
    channelInstanceId,
    from: event.from,
    displayName: event.profileName || undefined,
    content: event.content,
    contentType: event.contentType,
    externalMessageId: event.externalMessageId,
    profileName: event.profileName,
  })
}

export async function handleInbound(c: Context): Promise<Response> {
  const channelInstanceId = c.req.header('x-channel-instance-id') ?? ''
  if (!channelInstanceId) {
    return c.json({ error: 'missing x-channel-instance-id header' }, 400)
  }

  // Session auth takes precedence so widgets don't have to ship a shared secret.
  const session = await getSessionFromRequest(c.req.raw.headers)
  if (session) return handleSessionInbound(c, session, channelInstanceId)

  return handleHmacInbound(c, channelInstanceId)
}
