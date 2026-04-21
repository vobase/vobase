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
 */

import { filesServiceFor } from '@modules/drive/service/files'
import type { DriveScope } from '@modules/drive/service/types'
import { Hono } from 'hono'
import { z } from 'zod'

const DEFAULT_TENANT = process.env.DEFAULT_TENANT_ID ?? 'mer0tenant'

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

const app = new Hono()
  .get('/tree', async (c) => {
    const s = scopeFromQuery(c)
    if (!s.ok) return c.json({ error: 'invalid_scope', issues: s.issues }, 400)
    const organizationId = c.req.query('organizationId') ?? DEFAULT_TENANT
    const parentIdRaw = c.req.query('parentId')
    const parentId = parentIdRaw && parentIdRaw.length > 0 ? parentIdRaw : null
    const rows = await filesServiceFor(organizationId).listFolder(s.scope, parentId)
    return c.json(rows)
  })
  .get('/file', async (c) => {
    const s = scopeFromQuery(c)
    if (!s.ok) return c.json({ error: 'invalid_scope', issues: s.issues }, 400)
    const path = c.req.query('path')
    if (!path?.startsWith('/')) return c.json({ error: 'invalid_path' }, 400)
    const organizationId = c.req.query('organizationId') ?? DEFAULT_TENANT
    const result = await filesServiceFor(organizationId).readPath(s.scope, path)
    if (!result) return c.json({ error: 'not_found' }, 404)
    return c.json(result)
  })
  .put('/file', async (c) => {
    const raw = await c.req.json().catch(() => null)
    const parsed = writeFileBodySchema.safeParse(raw)
    if (!parsed.success) return c.json({ error: 'invalid_body', issues: parsed.error.issues }, 400)
    const organizationId = c.req.query('organizationId') ?? DEFAULT_TENANT
    const scope = toDriveScope(parsed.data)
    const file = await filesServiceFor(organizationId).writePath(scope, parsed.data.path, parsed.data.content)
    return c.json({ file })
  })
  .post('/folders', async (c) => {
    const raw = await c.req.json().catch(() => null)
    const parsed = mkdirBodySchema.safeParse(raw)
    if (!parsed.success) return c.json({ error: 'invalid_body', issues: parsed.error.issues }, 400)
    const organizationId = c.req.query('organizationId') ?? DEFAULT_TENANT
    const scope = toDriveScope(parsed.data)
    const file = await filesServiceFor(organizationId).mkdir(scope, parsed.data.path)
    return c.json({ file })
  })
  .post('/moves', async (c) => {
    const raw = await c.req.json().catch(() => null)
    const parsed = moveBodySchema.safeParse(raw)
    if (!parsed.success) return c.json({ error: 'invalid_body', issues: parsed.error.issues }, 400)
    const organizationId = c.req.query('organizationId') ?? DEFAULT_TENANT
    const file = await filesServiceFor(organizationId).move(parsed.data.id, parsed.data.newPath)
    return c.json({ file })
  })
  .delete('/file/:id', async (c) => {
    const id = c.req.param('id')
    const organizationId = c.req.query('organizationId') ?? DEFAULT_TENANT
    await filesServiceFor(organizationId).remove(id)
    return c.json({ ok: true, id })
  })

export default app
