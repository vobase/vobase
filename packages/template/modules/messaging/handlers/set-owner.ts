/** POST /api/messaging/conversations/:id/set-owner */

import { type OrganizationEnv, requireOrganization } from '@auth/middleware'
import { zValidator } from '@hono/zod-validator'
import { setOwner } from '@modules/messaging/service/conversations'
import { getConversation, notifyConversation } from '@modules/messaging/service/staff-ops'
import { Hono } from 'hono'
import { z } from 'zod'

// `ownerUserId: null` clears the owner (Unassigned). `by` is the acting
// principal for the journal entry; defaults to 'system' when omitted.
const setOwnerBodySchema = z.object({
  ownerUserId: z.string().min(1).nullable(),
  by: z.string().min(1).optional(),
})

const app = new Hono<OrganizationEnv>().use('*', requireOrganization).post(
  '/:id/set-owner',
  zValidator('json', setOwnerBodySchema, (result, c) => {
    if (!result.success) {
      return c.json({ error: 'invalid_body', issues: result.error.issues }, 400)
    }
  }),
  async (c) => {
    const id = c.req.param('id')
    const data = c.req.valid('json')
    const conv = await getConversation(id)
    if (!conv) return c.json({ error: 'not_found' }, 404)
    if (conv.organizationId !== c.get('organizationId')) return c.json({ error: 'forbidden' }, 403)
    const conversation = await setOwner(id, data.ownerUserId, data.by ?? 'system')
    await notifyConversation(id).catch(() => undefined)
    return c.json({ conversation })
  },
)

export default app
