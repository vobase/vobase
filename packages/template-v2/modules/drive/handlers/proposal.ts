/**
 * Drive proposal handlers — staff approve / reject tenant-drive proposals.
 *
 * Routes:
 *   GET  /api/drive/proposals          list pending proposals
 *   POST /api/drive/proposals/:id/decide  approve or reject
 *
 * All writes flow through modules/drive/service/proposal.ts — handlers are
 * thin: parse → validate → call service → serialize.
 */

import { decideDriveProposal } from '@modules/drive/service/proposal'
import { Hono } from 'hono'
import { z } from 'zod'

const app = new Hono()

const decideBodySchema = z.object({
  decision: z.enum(['approved', 'rejected']),
  decidedByUserId: z.string().min(1),
  note: z.string().optional(),
})

/** POST /api/drive/proposals/:id/decide */
app.post('/:id/decide', async (c) => {
  const { id } = c.req.param()
  const parsed = decideBodySchema.safeParse(await c.req.json())
  if (!parsed.success) {
    return c.json({ ok: false, error: parsed.error.message }, 400)
  }
  const { decision, decidedByUserId, note } = parsed.data

  await decideDriveProposal(id, decision, decidedByUserId, note)

  return c.json({ ok: true, proposalId: id, decision })
})

export default app
