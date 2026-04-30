/**
 * Drive file HTTP handlers — staff API for the UI drive browser.
 *
 * Scope discriminator lives in the query/body payload:
 *   { scope: 'organization' } | { scope: 'contact', contactId: '...' }
 *
 * Routes:
 *   GET    /tree?scope=...&contactId=&parentId=   listFolder
 *   GET    /file?scope=...&contactId=&path=...    readPath
 *   PUT    /file  { scope, contactId?, path, content }   writePath
 *   POST   /folders { scope, contactId?, path }           mkdir
 *   POST   /moves { id, newPath }                         move
 *   DELETE /file/:id                                      remove
 *
 * Thin: parse → validate → call service → serialize. Writes to scope=organization
 * are allowed (staff UI); the agent-side proposal flow lives in `./proposal.ts`.
 *
 * Scope-RBAC: most routes are gated by `scopeGate` / `bodyScopeGate` registered
 * in `./index.ts`. DELETE `/file/:id` and POST `/moves` carry their scope
 * inside the row, so they run `rowScopeCheck` in-handler against the row's
 * `(scope, scopeId)` after loading it.
 */

import { type OrganizationEnv, requireOrganization } from '@auth/middleware'
import { zValidator } from '@hono/zod-validator'
import { filesServiceFor } from '@modules/drive/service/files'
import type { DriveScope } from '@modules/drive/service/types'
import { Hono } from 'hono'
import { z } from 'zod'

import { rowScopeCheck, scopeFromRow } from './scope-check'

const scopeSchema = z.discriminatedUnion('scope', [
  z.object({ scope: z.literal('organization') }),
  z.object({ scope: z.literal('contact'), contactId: z.string().min(1) }),
  z.object({ scope: z.literal('staff'), userId: z.string().min(1) }),
  z.object({ scope: z.literal('agent'), agentId: z.string().min(1) }),
])

type ParsedScope = z.infer<typeof scopeSchema>

function scopeFromQuery(c: {
  req: { query: (k: string) => string | undefined }
}): { ok: true; scope: DriveScope } | { ok: false; issues: unknown } {
  const parsed = scopeSchema.safeParse({
    scope: c.req.query('scope'),
    contactId: c.req.query('contactId'),
    userId: c.req.query('userId'),
    agentId: c.req.query('agentId'),
  })
  if (!parsed.success) return { ok: false, issues: parsed.error.issues }
  return { ok: true, scope: toDriveScope(parsed.data) }
}

function toDriveScope(p: ParsedScope): DriveScope {
  if (p.scope === 'organization') return { scope: 'organization' }
  if (p.scope === 'staff') return { scope: 'staff', userId: p.userId }
  if (p.scope === 'agent') return { scope: 'agent', agentId: p.agentId }
  return { scope: 'contact', contactId: p.contactId }
}

const writeFileBodySchema = scopeSchema.and(
  z.object({
    path: z.string().startsWith('/'),
    content: z.string(),
  }),
)
const mkdirBodySchema = scopeSchema.and(z.object({ path: z.string().startsWith('/') }))
const moveBodySchema = z.object({
  id: z.string().min(1),
  newPath: z.string().startsWith('/'),
})

const app = new Hono<OrganizationEnv>()
  .use('*', requireOrganization)
  .get('/tree', async (c) => {
    const s = scopeFromQuery(c)
    if (!s.ok) return c.json({ error: 'invalid_scope', issues: s.issues }, 400)
    const parentIdRaw = c.req.query('parentId')
    const parentId = parentIdRaw && parentIdRaw.length > 0 ? parentIdRaw : null
    const rows = await filesServiceFor(c.get('organizationId')).listFolder(s.scope, parentId)
    return c.json(rows)
  })
  .get('/file', async (c) => {
    const s = scopeFromQuery(c)
    if (!s.ok) return c.json({ error: 'invalid_scope', issues: s.issues }, 400)
    const path = c.req.query('path')
    if (!path?.startsWith('/')) return c.json({ error: 'invalid_path' }, 400)
    const result = await filesServiceFor(c.get('organizationId')).readPath(s.scope, path)
    if (!result) return c.json({ error: 'not_found' }, 404)
    return c.json(result)
  })
  .put(
    '/file',
    zValidator('json', writeFileBodySchema, (result, c) => {
      if (!result.success) {
        return c.json({ error: 'invalid_body', issues: result.error.issues }, 400)
      }
    }),
    async (c) => {
      const data = c.req.valid('json')
      const scope = toDriveScope(data)
      const file = await filesServiceFor(c.get('organizationId')).writePath(scope, data.path, data.content)
      return c.json({ file })
    },
  )
  .post(
    '/folders',
    zValidator('json', mkdirBodySchema, (result, c) => {
      if (!result.success) {
        return c.json({ error: 'invalid_body', issues: result.error.issues }, 400)
      }
    }),
    async (c) => {
      const data = c.req.valid('json')
      const scope = toDriveScope(data)
      const file = await filesServiceFor(c.get('organizationId')).mkdir(scope, data.path)
      return c.json({ file })
    },
  )
  .post(
    '/moves',
    zValidator('json', moveBodySchema, (result, c) => {
      if (!result.success) {
        return c.json({ error: 'invalid_body', issues: result.error.issues }, 400)
      }
    }),
    async (c) => {
      const data = c.req.valid('json')
      const svc = filesServiceFor(c.get('organizationId'))
      const blocked = await rowScopeCheck(
        c,
        async () => {
          const row = await svc.get(data.id)
          if (!row) return null
          return scopeFromRow(row)
        },
        true,
      )
      if (blocked) return blocked
      const file = await svc.move(data.id, data.newPath)
      return c.json({ file })
    },
  )
  .delete('/file/:id', async (c) => {
    const id = c.req.param('id')
    const svc = filesServiceFor(c.get('organizationId'))
    const blocked = await rowScopeCheck(
      c,
      async () => {
        const row = await svc.get(id)
        if (!row) return null
        return scopeFromRow(row)
      },
      true,
    )
    if (blocked) return blocked
    await svc.remove(id)
    return c.json({ ok: true, id })
  })

export default app
