import type { Auth } from '@auth'
import { assertScopeAccess, type OrganizationEnv, requireOrganization } from '@auth/middleware'
import { zValidator } from '@hono/zod-validator'
import { DRIVE_STORAGE_BUCKET } from '@modules/drive/constants'
import { lookupMime } from '@modules/drive/lib/lookup-mime'
import { filesServiceFor, getDriveAuth, getDriveStorage } from '@modules/drive/service/files'
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
  .post('/upload', async (c) => {
    // Multipart upload — staff/admin route. Scope-write check runs HERE,
    // not in `ingestUpload` (Principle 7).
    let form: FormData
    try {
      form = await c.req.formData()
    } catch {
      return c.json({ error: 'invalid_multipart' }, 400)
    }
    const file = form.get('file')
    if (!(file instanceof File)) return c.json({ error: 'missing_file_field' }, 400)
    const scopeRaw = form.get('scope')
    const scopeIdRaw = form.get('scopeId')
    const basePathRaw = form.get('basePath')
    const scopeStr = typeof scopeRaw === 'string' ? scopeRaw : 'organization'
    const scopeIdStr = typeof scopeIdRaw === 'string' ? scopeIdRaw : undefined
    const basePathStr = typeof basePathRaw === 'string' ? basePathRaw : '/'
    const parsed = scopeSchema.safeParse({
      scope: scopeStr,
      contactId: scopeIdStr,
      userId: scopeIdStr,
      agentId: scopeIdStr,
    })
    if (!parsed.success) {
      return c.json({ error: 'invalid_scope', issues: parsed.error.issues }, 400)
    }
    const scope = toDriveScope(parsed.data)

    // Scope-write check before any service work.
    const auth = getDriveAuth() as Auth | null
    if (auth) {
      const blocked = await assertScopeAccess(auth, c, scope, true)
      if (blocked) return blocked
    }

    const session = c.get('session') as { user?: { id?: string } } | undefined
    const userId = session?.user?.id ?? null

    const bytes = new Uint8Array(await file.arrayBuffer())
    const originalName = file.name || 'upload'
    const browserMime = file.type
    const mimeType = browserMime && browserMime.length > 0 ? browserMime : lookupMime(originalName)
    const svc = filesServiceFor(c.get('organizationId'))
    try {
      const result = await svc.ingestUpload({
        organizationId: c.get('organizationId'),
        scope,
        originalName,
        mimeType,
        sizeBytes: bytes.length,
        bytes,
        source: 'staff_uploaded',
        uploadedBy: userId,
        basePath: basePathStr,
      })
      return c.json({ ok: true, ...result })
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err)
      if (msg.startsWith('overlay_path_collision')) {
        return c.json({ error: 'overlay_path_collision', message: msg }, 409)
      }
      return c.json({ error: 'upload_failed', message: msg }, 500)
    }
  })
  .get('/file/:id/raw', async (c) => {
    const id = c.req.param('id')
    const svc = filesServiceFor(c.get('organizationId'))
    const blocked = await rowScopeCheck(
      c,
      async () => {
        const row = await svc.get(id)
        if (!row) return null
        return scopeFromRow(row)
      },
      false,
    )
    if (blocked) return blocked
    const row = await svc.get(id)
    if (!row) return c.json({ error: 'not_found' }, 404)
    if (!row.storageKey) return c.json({ error: 'no_storage' }, 404)
    const storage = getDriveStorage()
    if (!storage) return c.json({ error: 'storage_unavailable' }, 503)
    let bytes: Uint8Array
    try {
      bytes = await storage.bucket(DRIVE_STORAGE_BUCKET).download(row.storageKey)
    } catch {
      return c.json({ error: 'download_failed' }, 500)
    }
    const filename = row.originalName ?? row.name
    // Re-wrap as a fresh Uint8Array<ArrayBuffer> — drizzle / S3-stub may hand
    // us a `SharedArrayBuffer`-backed view which `Response` rejects.
    const buf = new Uint8Array(bytes.byteLength)
    buf.set(bytes)
    return new Response(buf, {
      headers: {
        'content-type': row.mimeType ?? 'application/octet-stream',
        'content-disposition': `attachment; filename="${filename.replace(/"/gu, '_')}"`,
        'content-length': String(buf.length),
      },
    })
  })
  .post(
    '/search',
    zValidator(
      'json',
      z.object({
        query: z.string().min(1),
        scope: z.enum(['organization', 'contact', 'staff', 'agent']).optional(),
        scopeId: z.string().optional(),
        limit: z.number().int().min(1).max(50).optional(),
      }),
      (result, c) => {
        if (!result.success) {
          return c.json({ error: 'invalid_body', issues: result.error.issues }, 400)
        }
      },
    ),
    async (c) => {
      const data = c.req.valid('json')
      let scope: DriveScope | undefined
      if (data.scope === 'organization') scope = { scope: 'organization' }
      else if (data.scope === 'contact' && data.scopeId) scope = { scope: 'contact', contactId: data.scopeId }
      else if (data.scope === 'staff' && data.scopeId) scope = { scope: 'staff', userId: data.scopeId }
      else if (data.scope === 'agent' && data.scopeId) scope = { scope: 'agent', agentId: data.scopeId }
      const svc = filesServiceFor(c.get('organizationId'))
      const hits = await svc.searchDrive({
        organizationId: c.get('organizationId'),
        query: data.query,
        scope,
        limit: data.limit,
      })
      return c.json({ hits })
    },
  )

export default app
