/**
 * `/api/views` HTTP surface.
 *
 *   GET    /api/views?scope=...           → list saved views (active only)
 *   GET    /api/views/:slug?scope=...     → fetch one
 *   POST   /api/views                     → save (insert-or-update)
 *   DELETE /api/views/:slug?scope=...     → tombstone
 *   POST   /api/views/query               → execute the underlying viewable
 *                                            query and return rows
 */

import { zValidator } from '@hono/zod-validator'
import {
  executeQuery,
  filterSchema,
  get as getView,
  list as listViews,
  remove as removeView,
  savedViewBodySchema,
  save as saveView,
  sortSchema,
} from '@modules/views/service/views'
import { Hono } from 'hono'
import { z } from 'zod'

const saveBody = z.object({
  slug: z
    .string()
    .min(1)
    .max(64)
    .regex(/^[a-z0-9-]+$/, 'slug must be lowercase kebab-case'),
  scope: z.string().min(1).max(120),
  body: savedViewBodySchema,
})

const queryBody = z.object({
  scope: z.string().min(1).max(120),
  filters: z.array(filterSchema).optional(),
  sort: z.array(sortSchema).optional(),
  limit: z.number().int().positive().max(500).optional(),
  offset: z.number().int().nonnegative().optional(),
})

const slugScopeQuery = z.object({ scope: z.string().min(1).max(120) })

const app = new Hono()
  .get('/health', (c) => c.json({ module: 'views', status: 'ok' }))
  .get('/', async (c) => {
    const scope = c.req.query('scope') ?? undefined
    const rows = await listViews(scope)
    return c.json(rows)
  })
  .get(
    '/:slug',
    zValidator('query', slugScopeQuery, (result, c) => {
      if (!result.success) return c.json({ error: 'scope query param required' }, 400)
    }),
    async (c) => {
      const { scope } = c.req.valid('query')
      const row = await getView(c.req.param('slug'), scope)
      if (!row) return c.json({ error: 'not_found' }, 404)
      return c.json(row)
    },
  )
  .post(
    '/',
    zValidator('json', saveBody, (result, c) => {
      if (!result.success) return c.json({ error: 'invalid_body', issues: result.error.issues }, 400)
    }),
    async (c) => {
      const data = c.req.valid('json')
      const row = await saveView({ slug: data.slug, scope: data.scope, body: data.body, origin: 'user' })
      return c.json(row)
    },
  )
  .delete(
    '/:slug',
    zValidator('query', slugScopeQuery, (result, c) => {
      if (!result.success) return c.json({ error: 'scope query param required' }, 400)
    }),
    async (c) => {
      const { scope } = c.req.valid('query')
      await removeView(c.req.param('slug'), scope)
      return c.json({ ok: true })
    },
  )
  .post(
    '/query',
    zValidator('json', queryBody, (result, c) => {
      if (!result.success) return c.json({ error: 'invalid_body', issues: result.error.issues }, 400)
    }),
    async (c) => {
      const data = c.req.valid('json')
      // `executeQuery` throws `VobaseError` (notFound / validation) — let the
      // global error handler classify into 404/400 instead of flattening
      // every failure to 400 here.
      const result = await executeQuery(data)
      return c.json(result)
    },
  )

export default app
