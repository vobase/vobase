/**
 * Drive file handler tests — exercise routes against an in-memory db stub that
 * matches the shape `createFilesService` expects.
 *
 * The `mount()` helper wraps `app` with a fake-session middleware so
 * `requireOrganization` can populate `c.get('organizationId')`. Tests don't
 * exercise scope-RBAC (covered separately) — `getDriveAuth()` returns null
 * (auth never installed in these tests), so all scope gates fall through.
 */

import { afterEach, beforeEach, describe, expect, it } from 'bun:test'
import type { AppSession } from '@auth/middleware/require-session'
import type { DriveFile } from '@modules/drive/schema'
import { __resetFilesDbForTests, setFilesDb } from '@modules/drive/service/files'
import { Hono } from 'hono'

import app from './files'

const ORG_ID = 'tenant_test_0'
const USER_ID = 'test-user'

function makeFile(partial: Partial<DriveFile> & { id: string; path: string; kind: 'file' | 'folder' }): DriveFile {
  return {
    organizationId: ORG_ID,
    scope: 'organization',
    scopeId: ORG_ID,
    parentFolderId: null,
    name: partial.path.split('/').filter(Boolean).pop() ?? 'x',
    mimeType: 'text/markdown',
    sizeBytes: null,
    storageKey: null,
    caption: null,
    captionModel: null,
    captionUpdatedAt: null,
    extractedText: null,
    source: null,
    sourceMessageId: null,
    tags: [],
    uploadedBy: null,
    processingStatus: 'ready',
    processingError: null,
    threatScanReport: null,
    createdAt: new Date(0),
    updatedAt: new Date(0),
    ...partial,
  }
}

function makeDbStub(state: { files: DriveFile[] }): unknown {
  return {
    select: () => ({
      from: () => ({
        where: (_c: unknown) => {
          const p = Promise.resolve(state.files)
          return Object.assign(p, { limit: (_n: number) => Promise.resolve(state.files) })
        },
      }),
    }),
    insert: () => ({
      values: (v: Record<string, unknown>) => ({
        // biome-ignore lint/suspicious/useAwait: contract requires async signature
        returning: async () => {
          const row = makeFile({
            id: String(v.id ?? `f-${state.files.length + 1}`),
            path: String(v.path ?? '/x'),
            kind: (v.kind as 'file' | 'folder') ?? 'file',
            extractedText: (v.extractedText as string | null) ?? null,
            name: String(v.name ?? 'x'),
          })
          state.files.push(row)
          return [row]
        },
      }),
    }),
    update: () => ({
      set: (v: Record<string, unknown>) => ({
        where: (_c: unknown) => {
          for (const f of state.files) {
            if (v.extractedText !== undefined) f.extractedText = v.extractedText as string | null
            if (v.path !== undefined) f.path = v.path as string
          }
          const p = Promise.resolve(undefined)
          return Object.assign(p, { returning: async () => state.files.slice(0, 1) })
        },
      }),
    }),
    delete: () => ({
      // biome-ignore lint/suspicious/useAwait: contract requires async signature
      where: async (_c: unknown) => {
        state.files = []
      },
    }),
  }
}

let state: { files: DriveFile[] }

beforeEach(() => {
  state = { files: [] }
  setFilesDb(makeDbStub(state))
})
afterEach(() => {
  __resetFilesDbForTests()
})

const fakeSession: AppSession = {
  user: {
    id: USER_ID,
    email: 'test@example.com',
    emailVerified: true,
    name: 'Test User',
    createdAt: new Date(),
    updatedAt: new Date(),
  },
  session: {
    id: 'sess-1',
    userId: USER_ID,
    token: 'tok',
    expiresAt: new Date(Date.now() + 3600_000),
    createdAt: new Date(),
    updatedAt: new Date(),
    activeOrganizationId: ORG_ID,
  },
}

const mount = (): Hono => {
  const wrapper = new Hono()
  wrapper.use('*', async (c, next) => {
    c.set('session', fakeSession)
    await next()
  })
  wrapper.route('/', app)
  return wrapper
}

describe('drive file handlers', () => {
  it('GET /tree returns rows from listFolder', async () => {
    state.files = [makeFile({ id: 'f-1', path: '/BUSINESS.md', kind: 'file' })]
    const res = await mount().request(`/tree?scope=organization&organizationId=${ORG_ID}`)
    expect(res.status).toBe(200)
    expect(((await res.json()) as unknown as DriveFile[])[0]?.id).toBe('f-1')
  })

  it('GET /tree 400 on missing scope', async () => {
    expect((await mount().request('/tree')).status).toBe(400)
  })

  it('GET /tree 400 on contact scope without contactId', async () => {
    expect((await mount().request('/tree?scope=contact')).status).toBe(400)
  })

  it('GET /file returns readPath result', async () => {
    state.files = [makeFile({ id: 'f-1', path: '/BUSINESS.md', kind: 'file', extractedText: 'hello' })]
    const res = await mount().request(`/file?scope=organization&path=/BUSINESS.md&organizationId=${ORG_ID}`)
    expect(res.status).toBe(200)
    const body = (await res.json()) as unknown as { content: string; virtual: boolean }
    expect(body.content).toBe('hello')
    expect(body.virtual).toBe(false)
  })

  it('GET /file 404 on not-found', async () => {
    const res = await mount().request(`/file?scope=organization&path=/missing.md&organizationId=${ORG_ID}`)
    expect(res.status).toBe(404)
  })

  it('GET /file 400 on invalid path', async () => {
    const res = await mount().request(`/file?scope=organization&path=x&organizationId=${ORG_ID}`)
    expect(res.status).toBe(400)
  })

  it('PUT /file writes content via writePath', async () => {
    const res = await mount().request(`/file?organizationId=${ORG_ID}`, {
      method: 'PUT',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ scope: 'organization', path: '/pricing.md', content: '# Pricing' }),
    })
    expect(res.status).toBe(200)
    const body = (await res.json()) as unknown as { file: DriveFile }
    expect(body.file.path).toBe('/pricing.md')
    expect(body.file.extractedText).toBe('# Pricing')
  })

  it('PUT /file with contact scope does not 400 on missing query-string scope (regression)', async () => {
    state.files = [makeFile({ id: 'f-c1', path: '/notes.md', kind: 'file', scope: 'contact', scopeId: 'ctt0test00' })]
    const res = await mount().request('/file', {
      method: 'PUT',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ scope: 'contact', contactId: 'ctt0test00', path: '/notes.md', content: 'updated' }),
    })
    expect(res.status).toBe(200)
    const body = (await res.json()) as unknown as { file: DriveFile }
    expect(body.file.path).toBe('/notes.md')
  })

  it('PUT /file 400 on invalid body', async () => {
    const res = await mount().request('/file', {
      method: 'PUT',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ scope: 'organization', path: 'bad', content: 'x' }),
    })
    expect(res.status).toBe(400)
  })

  it('POST /folders creates a folder via mkdir', async () => {
    const res = await mount().request(`/folders?organizationId=${ORG_ID}`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ scope: 'organization', path: '/policies' }),
    })
    expect(res.status).toBe(200)
    const body = (await res.json()) as unknown as { file: DriveFile }
    expect(body.file.kind).toBe('folder')
    expect(body.file.path).toBe('/policies')
  })

  it('DELETE /file/:id calls remove', async () => {
    state.files = [makeFile({ id: 'f-1', path: '/x.md', kind: 'file' })]
    const res = await mount().request(`/file/f-1?organizationId=${ORG_ID}`, { method: 'DELETE' })
    expect(res.status).toBe(200)
    const body = (await res.json()) as unknown as { ok: boolean; id: string }
    expect(body.ok).toBe(true)
    expect(body.id).toBe('f-1')
  })

  it('DELETE /file/:id does not 400 in auth-off test mode (regression)', async () => {
    // In auth-off test mode `rowScopeCheck` short-circuits, so DELETE proceeds
    // even without a query-string scope param — this catches a regression of
    // the original bug where the route-level scopeGate would 400 the request.
    state.files = [makeFile({ id: 'f-2', path: '/y.md', kind: 'file' })]
    const res = await mount().request('/file/f-2', { method: 'DELETE' })
    expect(res.status).toBe(200)
    const body = (await res.json()) as unknown as { ok: boolean; id: string }
    expect(body.ok).toBe(true)
    expect(body.id).toBe('f-2')
  })
})
