/**
 * POST /api/channel-web/outbound — internal endpoint called by the wake worker.
 *
 * TRANSPORT-ONLY: calls dispatcher which persists via MessagingPort then pushes NOTIFY.
 * This handler MUST NOT write to the messages table directly (transport-only rule).
 */
import { ChannelOutboundEventSchema } from '@server/transports/events'
import type { Context } from 'hono'

import { dispatch } from '../service/dispatcher'
import { requireRealtime } from '../service/state'

export async function handleOutbound(c: Context): Promise<Response> {
  let body: unknown
  try {
    body = await c.req.json()
  } catch {
    return c.json({ error: 'invalid json' }, 400)
  }

  const parsed = ChannelOutboundEventSchema.safeParse(body)
  if (!parsed.success) {
    return c.json({ error: 'invalid outbound event', issues: parsed.error.issues }, 422)
  }

  const event = parsed.data

  if (event.channelType !== 'web') {
    return c.json({ error: 'channel mismatch — expected web' }, 400)
  }

  const result = await dispatch(event, requireRealtime())

  return c.json({ dispatched: true, messageId: result.messageId, notified: result.notified })
}
