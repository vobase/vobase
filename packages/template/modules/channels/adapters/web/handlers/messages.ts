/**
 * GET /api/channels/adapters/web/conversations/:id/messages
 *
 * Anonymous-session-friendly list of messages for the caller's own conversation.
 * The upstream messaging API requires staff membership (requireOrganization);
 * widget sessions are anonymous and can't pass that gate. This endpoint
 * authorises by proving the session owns the conversation: the conversation's
 * `contact_id` must match the contact resolved from the session's `user.id`
 * via `contact_external_keys` for `channel='web'`.
 */

import { getInstance } from '@modules/channels/service/instances'
import { getByExternalKey } from '@modules/contacts/service/contacts'
import { get as getConversation } from '@modules/messaging/service/conversations'
import { list as listMessages } from '@modules/messaging/service/messages'
import type { Context } from 'hono'

import { getSessionFromRequest } from '../service/inbound-auth'

export async function handleListMessages(c: Context): Promise<Response> {
  const conversationId = c.req.param('id')
  if (!conversationId) return c.json({ error: 'missing conversation id' }, 400)

  const session = await getSessionFromRequest(c.req.raw.headers)
  if (!session) return c.json({ error: 'no session' }, 401)

  let conversation
  try {
    conversation = await getConversation(conversationId)
  } catch {
    return c.json({ error: 'conversation not found' }, 404)
  }

  const instance = await getInstance(conversation.channelInstanceId)
  if (!instance || instance.channel !== 'web') {
    return c.json({ error: 'not a web channel conversation' }, 403)
  }

  const ownerContact = await getByExternalKey({
    organizationId: conversation.organizationId,
    channel: 'web',
    externalKey: session.user.id,
  })
  if (!ownerContact || ownerContact.id !== conversation.contactId) {
    return c.json({ error: 'forbidden' }, 403)
  }

  const limitRaw = c.req.query('limit')
  const limit = limitRaw ? Math.min(Math.max(Number(limitRaw), 1), 200) : 50
  const rows = await listMessages(conversationId, { limit })
  return c.json(rows)
}
