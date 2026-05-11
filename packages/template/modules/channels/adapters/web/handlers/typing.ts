/**
 * POST /api/channels/adapters/web/typing
 *
 * Customer-side typing presence — symmetric counterpart to the staff-side
 * `/api/messaging/conversations/:id/typing`. Bearer-authed via the chat
 * widget's anonymous better-auth session; resolves the conversation's
 * contact row to source the display name so the inbox can render
 * "{contactName} is typing…" above the composer.
 */

import { get as getContact } from '@modules/contacts/service/contacts'
import { getConversation, notifyTyping } from '@modules/messaging/service/staff-ops'
import type { Context } from 'hono'
import { z } from 'zod'

import { getSessionFromRequest } from '../service/inbound-auth'

const TypingBodySchema = z.object({
  conversationId: z.string().min(1),
})

export async function handleTyping(c: Context): Promise<Response> {
  const session = await getSessionFromRequest(c.req.raw.headers)
  if (!session) return c.json({ error: 'unauthorized' }, 401)

  const parsed = TypingBodySchema.safeParse(await c.req.json().catch(() => ({})))
  if (!parsed.success) return c.json({ error: 'invalid_body' }, 400)
  const { conversationId } = parsed.data

  const conv = await getConversation(conversationId).catch(() => null)
  if (!conv) return c.json({ error: 'not_found' }, 404)
  if (conv.organizationId !== session.session.activeOrganizationId) {
    return c.json({ error: 'forbidden' }, 403)
  }

  const contact = await getContact(conv.contactId).catch(() => null)
  const name = (contact?.displayName ?? '').trim() || 'Customer'
  await notifyTyping(conversationId, conv.contactId, name, 'customer').catch(() => undefined)
  return c.json({ ok: true })
}
