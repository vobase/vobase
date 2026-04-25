/** GET + POST /api/messaging/conversations/:id/notes */

import { zValidator } from '@hono/zod-validator'
import { addNote, listNotes } from '@modules/messaging/service/notes'
import { getConversation, notifyConversation } from '@modules/messaging/service/staff-ops'
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

const app = new Hono()
  .get('/:id/notes', async (c) => {
    const id = c.req.param('id')
    const organizationId = c.req.query('organizationId') ?? DEFAULT_TENANT
    const conv = await getConversation(id)
    if (!conv) return c.json({ error: 'not_found' }, 404)
    if (conv.organizationId !== organizationId) return c.json({ error: 'forbidden' }, 403)
    const rows = await listNotes(id)
    return c.json(rows)
  })
  .post(
    '/:id/notes',
    zValidator('json', noteBodySchema, (result, c) => {
      if (!result.success) {
        return c.json({ error: 'invalid_body', issues: result.error.issues }, 400)
      }
    }),
    async (c) => {
      const id = c.req.param('id')
      const organizationId = c.req.query('organizationId') ?? DEFAULT_TENANT
      const data = c.req.valid('json')
      const conv = await getConversation(id)
      if (!conv) return c.json({ error: 'not_found' }, 404)
      if (conv.organizationId !== organizationId) return c.json({ error: 'forbidden' }, 403)
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
    },
  )

export default app
