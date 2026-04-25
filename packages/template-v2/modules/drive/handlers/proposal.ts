/**
 * Drive proposal handlers — staff approve / reject organization-drive proposals.
 *
 * Routes:
 *   GET  /api/drive/proposals          list pending proposals
 *   POST /api/drive/proposals/:id/decide  approve or reject
 *
 * All writes flow through modules/drive/service/proposal.ts — handlers are
 * thin: parse → validate → call service → serialize.
 */

import { zValidator } from '@hono/zod-validator'
import { decideDriveProposal } from '@modules/drive/service/proposal'
import { Hono } from 'hono'
import { z } from 'zod'

const decideBodySchema = z.object({
  decision: z.enum(['approved', 'rejected']),
  decidedByUserId: z.string().min(1),
  note: z.string().optional(),
})

const app = new Hono().post(
  '/:id/decide',
  zValidator('json', decideBodySchema, (result, c) => {
    if (!result.success) {
      return c.json({ ok: false, error: result.error.message }, 400)
    }
  }),
  async (c) => {
    const { id } = c.req.param()
    const { decision, decidedByUserId, note } = c.req.valid('json')

    await decideDriveProposal(id, decision, decidedByUserId, note)

    return c.json({ ok: true, proposalId: id, decision })
  },
)

export default app
