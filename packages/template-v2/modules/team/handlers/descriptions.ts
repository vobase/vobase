/**
 * Team description HTTP handlers.
 *
 * Routes:
 *   GET    /descriptions              list descriptions for org
 *   GET    /descriptions/:teamId      single description
 *   PUT    /descriptions/:teamId      upsert description text
 *   DELETE /descriptions/:teamId      remove description row
 *
 * Team identity (name, membership) is managed through better-auth's
 * organization-teams plugin — this handler only owns the description text.
 */

import {
  getDescription,
  listDescriptions,
  removeDescription,
  upsertDescription,
} from '@modules/team/service/team-descriptions'
import { Hono } from 'hono'
import { z } from 'zod'

const DEFAULT_TENANT = process.env.DEFAULT_TENANT_ID ?? 'mer0tenant'

const upsertBody = z.object({
  description: z.string().max(4000),
})

const app = new Hono()
  .get('/descriptions', async (c) => {
    const organizationId = c.req.query('organizationId') ?? DEFAULT_TENANT
    const rows = await listDescriptions(organizationId)
    return c.json(rows)
  })
  .get('/descriptions/:teamId', async (c) => {
    const row = await getDescription(c.req.param('teamId'))
    if (!row) return c.json({ error: 'not_found' }, 404)
    return c.json(row)
  })
  .put('/descriptions/:teamId', async (c) => {
    const raw = await c.req.json().catch(() => null)
    const parsed = upsertBody.safeParse(raw)
    if (!parsed.success) return c.json({ error: 'invalid_body', issues: parsed.error.issues }, 400)
    const organizationId = c.req.query('organizationId') ?? DEFAULT_TENANT
    const row = await upsertDescription({
      teamId: c.req.param('teamId'),
      organizationId,
      description: parsed.data.description,
    })
    return c.json(row)
  })
  .delete('/descriptions/:teamId', async (c) => {
    await removeDescription(c.req.param('teamId'))
    return c.json({ ok: true, teamId: c.req.param('teamId') })
  })

export default app
