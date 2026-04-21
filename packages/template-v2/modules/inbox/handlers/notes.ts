/** POST /api/inbox/conversations/:id/notes */
import { addNote } from '@modules/inbox/service/notes'
import { getConversation, notifyConversation } from '@modules/inbox/service/staff-ops'
import { fanOutNoteMentions } from '@modules/team/service/mention-notify'
import { Hono } from 'hono'
import { z } from 'zod'

const DEFAULT_TENANT = process.env.DEFAULT_TENANT_ID ?? 'mer0tenant'

const noteBodySchema = z.object({
  body: z.string().min(1),
  authorType: z.enum(['staff', 'agent']),
  authorId: z.string().min(1),
  mentions: z.array(z.string()).optional(),
  parentNoteId: z.string().optional(),
})

const app = new Hono().post('/:id/notes', async (c) => {
  const id = c.req.param('id')
  const organizationId = c.req.query('organizationId') ?? DEFAULT_TENANT
  const raw = await c.req.json().catch(() => null)
  const parsed = noteBodySchema.safeParse(raw)
  if (!parsed.success) {
    return c.json({ error: 'invalid_body', issues: parsed.error.issues }, 400)
  }
  const conv = await getConversation(id)
  if (!conv) return c.json({ error: 'not_found' }, 404)
  if (conv.organizationId !== organizationId) return c.json({ error: 'forbidden' }, 403)
  const { data } = parsed
  const note = await addNote({
    organizationId,
    conversationId: id,
    author: { kind: data.authorType, id: data.authorId },
    body: data.body,
    mentions: data.mentions,
    parentNoteId: data.parentNoteId,
  })
  await notifyConversation(id).catch(() => undefined)
  try {
    void fanOutNoteMentions(note).catch(() => undefined)
  } catch {
    // service not installed in test contexts — best-effort
  }
  return c.json(note)
})

export default app
