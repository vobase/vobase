/** POST /api/messaging/approvals/:id — staff decision endpoint. */

import { zValidator } from '@hono/zod-validator'
import {
  ApprovalAssigneeInvalidError,
  ApprovalNotPendingError,
  ConversationMissingError,
  decide,
  persistRejectionNote,
} from '@modules/messaging/service/pending-approvals'
import { Hono } from 'hono'
import { z } from 'zod'

const decideBodySchema = z.object({
  decision: z.enum(['approved', 'rejected']),
  decidedByUserId: z.string().min(1),
  note: z.string().optional(),
})

const app = new Hono().post(
  '/:id',
  zValidator('json', decideBodySchema, (result, c) => {
    if (!result.success) {
      return c.json({ error: 'invalid_body', issues: result.error.issues }, 400)
    }
  }),
  async (c) => {
    const id = c.req.param('id')
    const data = c.req.valid('json')
    try {
      const result = await decide(id, data)
      // Staff-signal bridge: a rejection-with-note surfaces in the conversation
      // timeline as an `internal_note` so detectStaffSignals() picks it up on the
      // approval_resumed wake and memoryDistill can later materialise it as an
      // anti-lesson. Best-effort — swallow so a note write can never block a decide.
      if (data.decision === 'rejected' && data.note?.trim()) {
        await persistRejectionNote(result.approval, data.decidedByUserId, data.note).catch(() => undefined)
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
  },
)

export default app
