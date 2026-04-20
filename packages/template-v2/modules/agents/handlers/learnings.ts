/** GET /api/agents/learnings — list pending learning proposals for staff review. */
/** POST /api/agents/skills/:id/decide — staff approve / reject a learning proposal. */
import { decideProposal, listRecent } from '@modules/agents/service/learning-proposals'
import { Hono } from 'hono'
import { z } from 'zod'

const app = new Hono()

const decideBodySchema = z.object({
  decision: z.enum(['approved', 'rejected']),
  decidedByUserId: z.string().min(1).default('staff:current'),
  note: z.string().optional(),
})

app.get('/learnings', async (c) => {
  const organizationId = c.req.query('organizationId') ?? 'tenant_meridian'
  try {
    const proposals = await listRecent(organizationId, 'pending')
    return c.json(proposals)
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err)
    return c.json({ error: msg }, 500)
  }
})

app.post('/skills/:id/decide', async (c) => {
  const id = c.req.param('id')
  const raw = await c.req.json().catch(() => null)
  const parsed = decideBodySchema.safeParse(raw)
  if (!parsed.success) {
    return c.json({ error: 'invalid_body', issues: parsed.error.issues }, 400)
  }
  try {
    await decideProposal(id, parsed.data.decision, parsed.data.decidedByUserId, parsed.data.note)
    return c.json({ ok: true, proposalId: id, status: parsed.data.decision })
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err)
    return c.json({ error: msg }, 500)
  }
})

export default app
