/** POST /api/inbox/approvals/:id — staff decision endpoint. */
import {
  ApprovalAssigneeInvalidError,
  ApprovalNotPendingError,
  ConversationMissingError,
  decide,
  persistRejectionNote,
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
    // §13.1 staff-signal bridge: a rejection-with-note surfaces in the conversation
    // timeline as an `internal_note` so detectStaffSignals() picks it up on the
    // approval_resumed wake and memoryDistill can later materialise it as an
    // anti-lesson. Best-effort — swallow so a note write can never block a decide.
    if (parsed.data.decision === 'rejected' && parsed.data.note?.trim()) {
      await persistRejectionNote(result.approval, parsed.data.decidedByUserId, parsed.data.note).catch(() => undefined)
    }
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
