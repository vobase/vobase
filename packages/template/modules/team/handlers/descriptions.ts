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

import { type OrganizationEnv, requireOrganization } from '@auth/middleware'
import { zValidator } from '@hono/zod-validator'
import {
  getDescription,
  listDescriptions,
  removeDescription,
  upsertDescription,
} from '@modules/team/service/team-descriptions'
import { Hono } from 'hono'
import { z } from 'zod'

const upsertBody = z.object({
  description: z.string().max(4000),
  /**
   * @deprecated Routing no longer reads `team_descriptions.lead_user_id` — the
   * lead is derived from `staff_profiles.attributes` (`corporate_team` /
   * `private_team` / `team_lead`). The column is kept (nullable) for backwards
   * compatibility with older CLI clients; no current UI path sends it.
   */
  leadUserId: z.string().min(1).max(64).nullable().optional(),
})

const app = new Hono<OrganizationEnv>()
  .use('*', requireOrganization)
  .get('/descriptions', async (c) => {
    const rows = await listDescriptions(c.get('organizationId'))
    return c.json(rows)
  })
  .get('/descriptions/:teamId', async (c) => {
    const row = await getDescription(c.req.param('teamId'))
    if (!row) return c.json({ error: 'not_found' }, 404)
    return c.json(row)
  })
  .put(
    '/descriptions/:teamId',
    zValidator('json', upsertBody, (result, c) => {
      if (!result.success) {
        return c.json({ error: 'invalid_body', issues: result.error.issues }, 400)
      }
    }),
    async (c) => {
      const data = c.req.valid('json')
      const row = await upsertDescription({
        teamId: c.req.param('teamId'),
        organizationId: c.get('organizationId'),
        description: data.description,
        ...(data.leadUserId !== undefined ? { leadUserId: data.leadUserId } : {}),
      })
      return c.json(row)
    },
  )
  .delete('/descriptions/:teamId', async (c) => {
    await removeDescription(c.req.param('teamId'))
    return c.json({ ok: true, teamId: c.req.param('teamId') })
  })

export default app
