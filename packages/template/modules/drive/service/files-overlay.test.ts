/**
 * Unit tests for the drive overlay registry, the parseVirtualId discriminated
 * parser, and the listFolder/readPath/writePath provider integration in
 * `createFilesService`.
 *
 * Uses a hand-rolled in-memory db stub so the registry contract can be
 * exercised without Postgres; DB-backed flows are covered separately in the
 * e2e suite.
 */

import { afterEach, beforeEach, describe, expect, it } from 'bun:test'

import type { DriveFile } from '../schema'
import { createFilesService, virtualDriveFile } from './files'
import {
  __resetOverlaysForTests,
  type DriveOverlayProvider,
  listOverlayProviders,
  registerDriveOverlay,
} from './overlays'
import type { DriveScope } from './types'
import { formatBuiltinId, formatProviderId, parseVirtualId } from './virtual-ids'

/**
 * Stand-in for the real `agentBuiltinOverlay` registered in `drive/module.ts`.
 * The unit-test stubDb doesn't model `agentDefinitions`, so we register a
 * minimal overlay that mirrors the real provider's shape (ids start with
 * `virtual:agent:`, surfaces /AGENTS.md and /MEMORY.md at parentId=null).
 */
function registerAgentBuiltinStub(): void {
  registerDriveOverlay({
    id: 'drive/builtin-agent',
    appliesTo: ['agent'],
    list: (ctx) => {
      if (ctx.scope.scope !== 'agent') return Promise.resolve([])
      if (ctx.parentId !== null) return Promise.resolve([])
      const orgId = ctx.organizationId
      const agentId = ctx.scope.agentId
      return Promise.resolve([
        virtualDriveFile(orgId, 'agent', agentId, 'instructions', new Date(0)),
        virtualDriveFile(orgId, 'agent', agentId, 'memory', new Date(0)),
      ])
    },
    read: () => Promise.resolve(null),
  })
}

// ─── parseVirtualId / formatters ───────────────────────────────────────────

describe('parseVirtualId', () => {
  it('parses builtin contact:profile', () => {
    const v = parseVirtualId('virtual:contact:abc123:profile')
    expect(v).toEqual({ kind: 'builtin', backingScope: 'contact', scopeIdVal: 'abc123', field: 'profile' })
  })

  it('parses builtin staff:memory', () => {
    expect(parseVirtualId('virtual:staff:user-1:memory')).toEqual({
      kind: 'builtin',
      backingScope: 'staff',
      scopeIdVal: 'user-1',
      field: 'memory',
    })
  })

  it('parses builtin agent:instructions', () => {
    expect(parseVirtualId('virtual:agent:agt-1:instructions')).toEqual({
      kind: 'builtin',
      backingScope: 'agent',
      scopeIdVal: 'agt-1',
      field: 'instructions',
    })
  })

  it('parses provider id with namespaced providerId', () => {
    expect(parseVirtualId('virtual:provider:agents/skills:agt-1:dir')).toEqual({
      kind: 'provider',
      providerId: 'agents/skills',
      scopeIdVal: 'agt-1',
      key: 'dir',
    })
  })

  it('parses provider id with key containing colons', () => {
    expect(parseVirtualId('virtual:provider:team/cross:user-9:agent:abc:leaf')).toEqual({
      kind: 'provider',
      providerId: 'team/cross',
      scopeIdVal: 'user-9',
      key: 'agent:abc:leaf',
    })
  })

  it('returns null for malformed builtin (missing field)', () => {
    expect(parseVirtualId('virtual:contact:abc123')).toBeNull()
  })

  it('returns null for unknown backingScope', () => {
    expect(parseVirtualId('virtual:planet:earth:profile')).toBeNull()
  })

  it('returns null for unknown field', () => {
    expect(parseVirtualId('virtual:contact:abc123:weather')).toBeNull()
  })

  it('returns null for non-virtual ids', () => {
    expect(parseVirtualId('drv-abcd1234')).toBeNull()
    expect(parseVirtualId('')).toBeNull()
  })

  it('returns null when provider key is empty', () => {
    expect(parseVirtualId('virtual:provider:agents/skills:agt-1:')).toBeNull()
  })

  it('round-trips formatBuiltinId', () => {
    const id = formatBuiltinId('contact', 'abc123', 'profile')
    expect(id).toBe('virtual:contact:abc123:profile')
    expect(parseVirtualId(id)?.kind).toBe('builtin')
  })

  it('round-trips formatProviderId', () => {
    const id = formatProviderId('agents/skills', 'agt-1', 'leaf:triage')
    expect(id).toBe('virtual:provider:agents/skills:agt-1:leaf:triage')
    const parsed = parseVirtualId(id)
    expect(parsed).toEqual({
      kind: 'provider',
      providerId: 'agents/skills',
      scopeIdVal: 'agt-1',
      key: 'leaf:triage',
    })
  })
})

// ─── registry contract ─────────────────────────────────────────────────────

function makeProvider(id: string, scopes: readonly ('contact' | 'staff' | 'agent' | 'organization')[] = ['agent']) {
  const provider: DriveOverlayProvider = {
    id,
    appliesTo: scopes,
    list: () => Promise.resolve([]),
    read: () => Promise.resolve(null),
  }
  return provider
}

describe('drive overlay registry', () => {
  beforeEach(() => {
    __resetOverlaysForTests()
  })
  afterEach(() => {
    __resetOverlaysForTests()
  })

  it('registers and lists by scope', () => {
    registerDriveOverlay(makeProvider('agents/skills', ['agent']))
    registerDriveOverlay(makeProvider('team/staff-cross-agent-memory', ['staff']))
    expect(listOverlayProviders('agent').map((p) => p.id)).toEqual(['agents/skills'])
    expect(listOverlayProviders('staff').map((p) => p.id)).toEqual(['team/staff-cross-agent-memory'])
    expect(listOverlayProviders('contact')).toEqual([])
    expect(listOverlayProviders('organization')).toEqual([])
  })

  it('throws on duplicate id (fail-fast, not last-write-wins)', () => {
    registerDriveOverlay(makeProvider('agents/skills', ['agent']))
    expect(() => registerDriveOverlay(makeProvider('agents/skills', ['agent']))).toThrow(
      "drive/overlays: duplicate provider id 'agents/skills'",
    )
  })

  it('__resetOverlaysForTests clears registry', () => {
    registerDriveOverlay(makeProvider('agents/skills'))
    expect(listOverlayProviders('agent')).toHaveLength(1)
    __resetOverlaysForTests()
    expect(listOverlayProviders('agent')).toHaveLength(0)
  })

  it('register-after-init still surfaces the provider on subsequent listProviders calls (lazy lookup)', () => {
    // Mimics drive boot order: drive's init would have run, but agents/team
    // register their providers afterwards. The registry is a process
    // singleton consulted at request time, never at boot.
    expect(listOverlayProviders('agent')).toHaveLength(0)
    registerDriveOverlay(makeProvider('agents/skills', ['agent']))
    expect(listOverlayProviders('agent').map((p) => p.id)).toEqual(['agents/skills'])
  })
})

// ─── files service integration with overlays ──────────────────────────────

const ORG = 'org-1'
const AGENT_SCOPE: DriveScope = { scope: 'agent', agentId: 'agt-1' }

interface FakeDb {
  rows: DriveFile[]
}

function fakeDb(): FakeDb {
  return { rows: [] }
}

/**
 * Hand-rolled chainable stub that mimics the slice of drizzle-orm the
 * FilesService uses. It returns whatever is in `db.rows` for any select; we
 * skip the where-clause filters in this unit test because the registry
 * integration tests don't rely on row-level scoping.
 */
function stubDb(state: FakeDb) {
  type Where = { limit: (n: number) => Promise<unknown[]> } & Promise<unknown[]>
  const wherePromise = (rows: unknown[]): Where => {
    const limited = (n: number) => Promise.resolve(rows.slice(0, n))
    const p = Promise.resolve(rows) as Where
    p.limit = limited
    return p
  }
  return {
    select: (_cols?: unknown) => ({
      from: (_t: unknown) => ({
        where: (_c: unknown) => wherePromise(state.rows),
      }),
    }),
    insert: (_t: unknown) => ({
      values: (v: unknown) => ({
        returning: () => {
          const file = v as DriveFile
          state.rows.push(file)
          return Promise.resolve([file])
        },
      }),
    }),
    update: (_t: unknown) => ({
      set: (_v: unknown) => {
        const w = (_c: unknown) => {
          const result = Promise.resolve(state.rows) as Promise<unknown> & { returning: () => Promise<unknown[]> }
          result.returning = () => Promise.resolve(state.rows)
          return result
        }
        return { where: w }
      },
    }),
    delete: (_t: unknown) => ({
      where: (_c: unknown) => Promise.resolve(),
    }),
  }
}

describe('createFilesService + overlay providers', () => {
  beforeEach(() => {
    __resetOverlaysForTests()
  })
  afterEach(() => {
    __resetOverlaysForTests()
  })

  it('listFolder includes provider rows alongside built-in overlays', async () => {
    const synthFolder: DriveFile = {
      id: formatProviderId('agents/skills', 'agt-1', 'dir'),
      organizationId: ORG,
      scope: 'agent',
      scopeId: 'agt-1',
      parentFolderId: null,
      kind: 'folder',
      name: 'skills',
      path: '/skills',
      mimeType: null,
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
    }

    registerDriveOverlay({
      id: 'agents/skills',
      appliesTo: ['agent'],
      list: (ctx) => {
        expect(ctx.organizationId).toBe(ORG) // invariant: ctx is threaded through
        return Promise.resolve(ctx.parentId === null ? [synthFolder] : [])
      },
      read: () => Promise.resolve(null),
    })
    registerAgentBuiltinStub()

    const state = fakeDb()
    const svc = createFilesService({ db: stubDb(state), organizationId: ORG })
    const rows = await svc.listFolder(AGENT_SCOPE, null)
    const ids = rows.map((r) => r.id)
    expect(ids).toContain(synthFolder.id) // provider row present
    expect(rows.some((r) => r.name === 'AGENTS.md')).toBe(true) // built-in overlay still present
    expect(rows.some((r) => r.name === 'MEMORY.md')).toBe(true)
    // All scopes now use MEMORY.md (matches harness convention) — never NOTES.md
    expect(rows.some((r) => r.name === 'NOTES.md')).toBe(false)
  })

  it('listFolder is failure-isolated: a throwing provider does not blank the response', async () => {
    registerDriveOverlay({
      id: 'broken',
      appliesTo: ['agent'],
      list: () => Promise.reject(new Error('boom')),
      read: () => Promise.resolve(null),
    })
    registerAgentBuiltinStub()

    const state = fakeDb()
    const svc = createFilesService({ db: stubDb(state), organizationId: ORG })
    const rows = await svc.listFolder(AGENT_SCOPE, null)
    // built-in AGENTS.md/MEMORY.md still surface even though provider exploded
    expect(rows.some((r) => r.name === 'AGENTS.md')).toBe(true)
  })

  it('listFolder dedupes provider rows whose path collides with a built-in overlay (built-in wins)', async () => {
    const collidingRow: DriveFile = {
      id: formatProviderId('rogue', 'agt-1', 'leaf'),
      organizationId: ORG,
      scope: 'agent',
      scopeId: 'agt-1',
      parentFolderId: null,
      kind: 'file',
      name: 'AGENTS.md',
      path: '/AGENTS.md',
      mimeType: 'text/markdown',
      sizeBytes: null,
      storageKey: null,
      caption: null,
      captionModel: null,
      captionUpdatedAt: null,
      extractedText: 'rogue body',
      source: null,
      sourceMessageId: null,
      tags: [],
      uploadedBy: null,
      processingStatus: 'ready',
      processingError: null,
      threatScanReport: null,
      createdAt: new Date(0),
      updatedAt: new Date(0),
    }
    // Register builtin BEFORE the rogue provider so the dedup (first-wins)
    // surfaces the builtin row at /AGENTS.md. Drive's module registers
    // builtins first in production for the same reason.
    registerAgentBuiltinStub()
    registerDriveOverlay({
      id: 'rogue',
      appliesTo: ['agent'],
      list: () => Promise.resolve([collidingRow]),
      read: () => Promise.resolve(null),
    })
    const state = fakeDb()
    const svc = createFilesService({ db: stubDb(state), organizationId: ORG })
    const rows = await svc.listFolder(AGENT_SCOPE, null)
    const agentsMdRows = rows.filter((r) => r.path === '/AGENTS.md')
    expect(agentsMdRows).toHaveLength(1)
    // the surviving row is the built-in (id starts with 'virtual:agent:')
    expect(agentsMdRows[0]?.id.startsWith('virtual:agent:')).toBe(true)
  })

  it('readPath dispatches to provider when no built-in or real row matches', async () => {
    registerDriveOverlay({
      id: 'agents/skills',
      appliesTo: ['agent'],
      list: () => Promise.resolve([]),
      read: (ctx) => {
        expect(ctx.organizationId).toBe(ORG)
        return Promise.resolve(ctx.path === '/skills/triage.md' ? { content: 'triage body' } : null)
      },
    })
    const state = fakeDb()
    const svc = createFilesService({ db: stubDb(state), organizationId: ORG })
    const result = await svc.readPath(AGENT_SCOPE, '/skills/triage.md')
    expect(result?.virtual).toBe(true)
    expect(result?.content).toBe('triage body')
    expect(result?.file?.path).toBe('/skills/triage.md')
  })

  it('readPath returns null when neither real, built-in, nor provider matches', async () => {
    const state = fakeDb()
    const svc = createFilesService({ db: stubDb(state), organizationId: ORG })
    const result = await svc.readPath(AGENT_SCOPE, '/skills/nonexistent.md')
    expect(result).toBeNull()
  })

  it('readContent rejects provider virtual ids with a clear error (use readPath instead)', async () => {
    const state = fakeDb()
    const svc = createFilesService({ db: stubDb(state), organizationId: ORG })
    const id = formatProviderId('agents/skills', 'agt-1', 'leaf:triage')
    await expect(svc.readContent(id)).rejects.toThrow(/cannot read provider virtual id directly/)
  })

  it('readContent still resolves built-in virtual ids (no-op rewrite of legacy as-cast)', async () => {
    // No DB rows needed for this case — readContent for builtin only needs
    // readVirtualColumn, which queries contacts/staff/agent tables; the stub
    // returns [] which makes the underlying lookup throw. We patch by
    // ensuring the parse step runs and dispatches to the right branch.
    const state = fakeDb()
    const svc = createFilesService({ db: stubDb(state), organizationId: ORG })
    // The builtin path will throw a "not found" because the stub db returns
    // no rows for the contacts/agents lookup — but the throw must come from
    // *that* lookup, not from a parse failure or a cast.
    const id = formatBuiltinId('contact', 'abc123', 'profile')
    await expect(svc.readContent(id)).rejects.toThrow(/contact not found/)
  })
})
