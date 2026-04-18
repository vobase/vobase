/** POST /api/inbox/approvals/:id — staff decision endpoint. */
import {
  ApprovalAssigneeInvalidError,
  ApprovalNotPendingError,
  ConversationMissingError,
  decide,
} from '@modules/inbox/service/pending-approvals'
import { Hono } from 'hono'
import { z } from 'zod'

const decideBodySchema = z.object({
  decision: z.enum(['approved', 'rejected']),
  decidedByUserId: z.string().min(1),
  note: z.string().optional(),
})

const app = new Hono()

app.post('/:id', async (c) => {
  const id = c.req.param('id')
  const raw = await c.req.json().catch(() => null)
  const parsed = decideBodySchema.safeParse(raw)
  if (!parsed.success) {
    return c.json({ error: 'invalid_body', issues: parsed.error.issues }, 400)
  }
  try {
    const result = await decide(id, parsed.data)
    return c.json({
      ok: true,
      approvalId: result.approval.id,
      status: result.approval.status,
      enqueued: result.enqueued,
      trigger: { ...result.trigger },
    })
  } catch (err) {
    if (err instanceof ApprovalNotPendingError) {
      return c.json({ error: err.message, code: err.code }, 409)
    }
    if (err instanceof ConversationMissingError || err instanceof ApprovalAssigneeInvalidError) {
      return c.json({ error: err.message, code: err.code }, 500)
    }
    const msg = err instanceof Error ? err.message : String(err)
    return c.json({ error: msg }, 500)
  }
})

export default app
