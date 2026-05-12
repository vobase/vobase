/**
 * GET /api/channels/adapters/web/conversations/:id/messages
 *
 * Public message-fetch route for the chat widget. The dashboard's
 * `/api/messaging/conversations/:id/messages` is gated by `requireOrganization`
 * — anonymous chat sessions don't have an active org, so it 403s. Auth: same
 * anonymous bearer as `/inbound`/`/typing`; we look up the per-session web
 * contact and verify it owns the conversation.
 */
import { findByExternalKey } from '@modules/contacts/service/contacts'
import { list as listMessages } from '@modules/messaging/service/messages'
import { getConversation } from '@modules/messaging/service/staff-ops'
import type { Context } from 'hono'

import { WEB_CHANNEL_NAME } from '../adapter'
import { getSessionFromRequest } from '../service/inbound-auth'

export async function handleConversationMessages(c: Context): Promise<Response> {
  const session = await getSessionFromRequest(c.req.raw.headers)
  if (!session) return c.json({ error: 'unauthorized' }, 401)

  const id = c.req.param('id')
  if (!id) return c.json({ error: 'missing_id' }, 400)
  const conv = await getConversation(id).catch(() => null)
  if (!conv) return c.json({ error: 'not_found' }, 404)

  const contact = await findByExternalKey({
    organizationId: conv.organizationId,
    channel: WEB_CHANNEL_NAME,
    externalKey: session.user.id,
  })
  if (!contact || contact.id !== conv.contactId) return c.json({ error: 'forbidden' }, 403)

  const limitRaw = c.req.query('limit')
  const limit = Math.min(Number(limitRaw ?? 50) || 50, 200)
  const rows = await listMessages(id, { limit })
  return c.json(rows)
}
