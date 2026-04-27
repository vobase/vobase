import { type OrganizationEnv, requireOrganization } from '@auth/middleware'
import { zValidator } from '@hono/zod-validator'
import { errorHandler } from '@vobase/core'
import { Hono } from 'hono'
import { z } from 'zod'

import { decideChangeProposal, listInbox } from '../service/proposals'

const decideBodySchema = z.object({
  decision: z.enum(['approved', 'rejected']),
  decidedByUserId: z.string().min(1).default('staff:current'),
  note: z.string().optional(),
})

const app = new Hono<OrganizationEnv>()
  .use('/inbox', requireOrganization)
  .use('/proposals/:id/decide', requireOrganization)
  .get('/inbox', async (c) => {
    const proposals = await listInbox(c.get('organizationId'))
    return c.json(proposals)
  })
  .post(
    '/proposals/:id/decide',
    zValidator('json', decideBodySchema, (result, c) => {
      if (!result.success) {
        return c.json({ error: 'invalid_body', issues: result.error.issues }, 400)
      }
    }),
    async (c) => {
      const id = c.req.param('id')
      const data = c.req.valid('json')
      const result = await decideChangeProposal(id, data.decision, data.decidedByUserId, data.note)
      return c.json({ ok: true, ...result })
    },
  )
  .onError(errorHandler)

export default app
