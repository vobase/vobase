/** GET /api/agents/learnings — list pending learning proposals for staff review. */
/** POST /api/agents/skills/:id/decide — staff approve / reject a learning proposal. */

import { zValidator } from '@hono/zod-validator'
import { decideProposal, listRecent } from '@modules/agents/service/learning-proposals'
import { Hono } from 'hono'
import { z } from 'zod'

const decideBodySchema = z.object({
  decision: z.enum(['approved', 'rejected']),
  decidedByUserId: z.string().min(1).default('staff:current'),
  note: z.string().optional(),
})

const app = new Hono()
  .get('/learnings', async (c) => {
    const organizationId = c.req.query('organizationId') ?? 'tenant_meridian'
    try {
      const proposals = await listRecent(organizationId, 'pending')
      return c.json(proposals)
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err)
      return c.json({ error: msg }, 500)
    }
  })
  .post(
    '/skills/:id/decide',
    zValidator('json', decideBodySchema, (result, c) => {
      if (!result.success) {
        return c.json({ error: 'invalid_body', issues: result.error.issues }, 400)
      }
    }),
    async (c) => {
      const id = c.req.param('id')
      const data = c.req.valid('json')
      try {
        await decideProposal(id, data.decision, data.decidedByUserId, data.note)
        return c.json({ ok: true, proposalId: id, status: data.decision })
      } catch (err) {
        const msg = err instanceof Error ? err.message : String(err)
        return c.json({ error: msg }, 500)
      }
    },
  )

export default app
