/**
 * Routing-rules HTTP handlers — admin UI seam for `team.routing_rules`.
 *
 * Three kinds, discriminated by `kind`:
 *   - `exclusive`    — keyword → repUserId
 *   - `pool_keyword` — keyword → pool
 *   - `pool_member`  — pool → repUserId
 *
 * Writes funnel through `LeadRoutingService.{upsertRule,removeRule}` so the
 * same delete-then-insert keying as `route_lead` is preserved.
 */

import { type OrganizationEnv, requireOrganization } from '@auth/middleware'
import { zValidator } from '@hono/zod-validator'
import { listRoutingRules, removeRoutingRule, upsertRoutingRule } from '@modules/team/service/lead-routing'
import { Hono } from 'hono'
import { z } from 'zod'

const upsertBody = z
  .object({
    kind: z.enum(['exclusive', 'pool_keyword', 'pool_member']),
    keyword: z.string().trim().min(1).max(200).nullable().optional(),
    pool: z.string().trim().min(1).max(64).nullable().optional(),
    repUserId: z.string().trim().min(1).max(64).nullable().optional(),
    priority: z.number().int().min(0).max(1000).optional(),
  })
  .superRefine((data, ctx) => {
    if (data.kind === 'exclusive') {
      if (!data.keyword) ctx.addIssue({ code: 'custom', path: ['keyword'], message: 'required for exclusive' })
      if (!data.repUserId) ctx.addIssue({ code: 'custom', path: ['repUserId'], message: 'required for exclusive' })
    } else if (data.kind === 'pool_keyword') {
      if (!data.keyword) ctx.addIssue({ code: 'custom', path: ['keyword'], message: 'required for pool_keyword' })
      if (!data.pool) ctx.addIssue({ code: 'custom', path: ['pool'], message: 'required for pool_keyword' })
    } else if (data.kind === 'pool_member') {
      if (!data.pool) ctx.addIssue({ code: 'custom', path: ['pool'], message: 'required for pool_member' })
      if (!data.repUserId) ctx.addIssue({ code: 'custom', path: ['repUserId'], message: 'required for pool_member' })
    }
  })

const app = new Hono<OrganizationEnv>()
  .use('*', requireOrganization)
  .get('/routing-rules', async (c) => {
    const rows = await listRoutingRules(c.get('organizationId'))
    return c.json(rows)
  })
  .post(
    '/routing-rules',
    zValidator('json', upsertBody, (result, c) => {
      if (!result.success) {
        return c.json({ error: 'invalid_body', issues: result.error.issues }, 400)
      }
    }),
    async (c) => {
      const data = c.req.valid('json')
      const row = await upsertRoutingRule({
        organizationId: c.get('organizationId'),
        kind: data.kind,
        keyword: data.kind === 'pool_member' ? null : (data.keyword ?? null),
        pool: data.kind === 'exclusive' ? null : (data.pool ?? null),
        repUserId: data.kind === 'pool_keyword' ? null : (data.repUserId ?? null),
        priority: data.priority ?? 0,
      })
      return c.json(row)
    },
  )
  .delete('/routing-rules/:id', async (c) => {
    const id = c.req.param('id')
    await removeRoutingRule(c.get('organizationId'), id)
    return c.json({ ok: true, id })
  })

export default app
