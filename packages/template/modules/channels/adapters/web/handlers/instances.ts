/**
 * Web-specific instance helpers.
 *
 * Cross-channel CRUD lives in `modules/channels/handlers/instances.ts`. This
 * file owns only the public chat-link metadata endpoint that the public
 * `/chat/:id` page consumes (no auth, no organization scope).
 */

import { getPublicInstance } from '@modules/channels/adapters/web/service/instances'
import { Hono } from 'hono'

const app = new Hono().get('/:id/public', async (c) => {
  const id = c.req.param('id')
  const pub = await getPublicInstance(id)
  if (!pub) return c.json({ error: 'not_found' }, 404)
  return c.json(pub)
})

export default app
