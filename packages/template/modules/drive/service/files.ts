/**
 * Drive files service — factory-DI, scope-partitioned by (scope, scope_id).
 *
 * Real reads: getByPath, listFolder, readContent, getBusinessMd, get.
 * Real writes: create, mkdir, move, remove.
 *
 * Virtual overlay (`contact` + `staff` scopes):
 *   - `/PROFILE.md` ↔ `contacts.profile` / `staff_profiles.profile`
 *   - `/MEMORY.md`  ↔ `contacts.memory`  / `staff_profiles.memory`
 * Virtual overlay (`agent` scope):
 *   - `/AGENTS.md`  ↔ `agent_definitions.instructions`
 *   - `/MEMORY.md`  ↔ `agent_definitions.working_memory`
 *
 * `readPath` / `writePath` unify real + virtual. Virtual reads prepend a
 * single-line sentinel header; virtual writes strip any sentinel lines before
 * persisting to the backing column. `listFolder` at root surfaces the
 * virtual entries even when no `drive.files` rows exist.
 *
 * `grep`, `ingestUpload`, `saveInboundMessageAttachment`, `deleteScope` remain
 * stubbed — covered by later slices.
 */

import { agentDefinitions } from '@modules/agents/schema'
import { contacts } from '@modules/contacts/schema'
import { driveFiles } from '@modules/drive/schema'
import { staffProfiles } from '@modules/team/schema'
import { and, eq, isNull } from 'drizzle-orm'

import type { DriveFile } from '../schema'
import { listOverlayProviders } from './overlays'
import type { CreateFileInput, DriveScope, GrepMatch, GrepOpts, IngestUploadInput } from './types'
import { parseVirtualId, type VirtualBackingScope, type VirtualField } from './virtual-ids'

/** Fallback content when /BUSINESS.md is absent from the drive. */
export const BUSINESS_MD_FALLBACK = 'No business profile configured. Ask staff to create /BUSINESS.md in the drive.'

/** Sentinel line prepended to virtual-file reads; stripped on write. */
const VIRTUAL_HEADER_PREFIX = '<!-- drive:virtual'
const virtualHeader = (scope: VirtualBackingScope, field: VirtualField): string => {
  const source =
    scope === 'contact'
      ? `contacts.${field}`
      : scope === 'staff'
        ? `staff_profiles.${field}`
        : field === 'instructions'
          ? 'agent_definitions.instructions'
          : 'agent_definitions.working_memory'
  return `${VIRTUAL_HEADER_PREFIX} field=${field} source=${source} -->`
}

type FilesDb = {
  select: (cols?: unknown) => {
    from: (t: unknown) => {
      where: (c: unknown) => {
        limit: (n: number) => Promise<unknown[]>
      } & Promise<unknown[]>
    }
  }
  insert: (t: unknown) => {
    values: (v: unknown) => {
      returning: () => Promise<unknown[]>
    }
  }
  update: (t: unknown) => {
    set: (v: unknown) => {
      where: (c: unknown) => Promise<unknown> & {
        returning: () => Promise<unknown[]>
      }
    }
  }
  delete: (t: unknown) => {
    where: (c: unknown) => Promise<unknown>
  }
}

export interface ReadPathResult {
  content: string
  virtual: boolean
  file: DriveFile | null
}

export interface FilesService {
  getByPath(scope: DriveScope, path: string): Promise<DriveFile | null>
  listFolder(scope: DriveScope, parentId: string | null): Promise<DriveFile[]>
  readContent(id: string): Promise<{ content: string; spilledToPath?: string }>
  readPath(scope: DriveScope, path: string): Promise<ReadPathResult | null>
  writePath(scope: DriveScope, path: string, content: string): Promise<DriveFile | null>
  getBusinessMd(): Promise<string>
  get(id: string): Promise<DriveFile | null>
  grep(scope: DriveScope, pattern: string, opts?: GrepOpts): Promise<GrepMatch[]>
  create(scope: DriveScope, input: CreateFileInput): Promise<DriveFile>
  mkdir(scope: DriveScope, path: string): Promise<DriveFile>
  move(id: string, newPath: string): Promise<DriveFile>
  remove(id: string): Promise<void>
  ingestUpload(input: IngestUploadInput): Promise<DriveFile>
  saveInboundMessageAttachment(msgId: string, targetPath?: string): Promise<DriveFile>
  deleteScope(scope: 'contact' | 'staff', scopeId: string): Promise<void>
}

export interface FilesServiceDeps {
  db: unknown
  organizationId: string
}

/** If `(scope, path)` is a contact/staff/agent virtual path, return the logical field name. */
export function resolveVirtualField(scope: DriveScope, path: string): VirtualField | null {
  if (scope.scope === 'contact' || scope.scope === 'staff') {
    if (path === '/PROFILE.md') return 'profile'
    if (path === '/MEMORY.md') return 'memory'
    return null
  }
  if (scope.scope === 'agent') {
    if (path === '/AGENTS.md') return 'instructions'
    if (path === '/MEMORY.md') return 'memory'
    return null
  }
  return null
}

/** Strip any `<!-- drive:virtual ... -->` sentinel lines from user-submitted content. */
export function stripVirtualHeader(content: string): string {
  const lines = content.split('\n')
  const filtered = lines.filter((l) => !l.trimStart().startsWith(VIRTUAL_HEADER_PREFIX))
  // Trim leading blank lines that may result from stripping a header + blank separator.
  while (filtered.length > 0 && filtered[0] === '') filtered.shift()
  return filtered.join('\n')
}

/** Compose `header\n\nbody` for virtual-file reads. */
export function composeVirtualContent(
  field: VirtualField,
  body: string,
  backingScope: VirtualBackingScope = 'contact',
): string {
  const header = virtualHeader(backingScope, field)
  return body ? `${header}\n\n${body}` : `${header}\n`
}

function basenameOf(path: string): string {
  const parts = path.split('/').filter(Boolean)
  return parts[parts.length - 1] ?? ''
}

function parentPathOf(path: string): string | null {
  const parts = path.split('/').filter(Boolean)
  if (parts.length <= 1) return null
  return `/${parts.slice(0, -1).join('/')}`
}

function virtualFileName(field: VirtualField): string {
  if (field === 'profile') return 'PROFILE.md'
  if (field === 'instructions') return 'AGENTS.md'
  return 'MEMORY.md'
}

export function virtualDriveFile(
  organizationId: string,
  backingScope: VirtualBackingScope,
  scopeId: string,
  field: VirtualField,
  updatedAt: Date = new Date(0),
): DriveFile {
  const name = virtualFileName(field)
  return {
    id: `virtual:${backingScope}:${scopeId}:${field}`,
    organizationId,
    scope: backingScope,
    scopeId,
    parentFolderId: null,
    kind: 'file',
    name,
    path: `/${name}`,
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
    createdAt: updatedAt,
    updatedAt,
  }
}

export function createFilesService(deps: FilesServiceDeps): FilesService {
  const db = deps.db as FilesDb
  const organizationId = deps.organizationId

  function scopeId(scope: DriveScope): { scopeName: string; scopeIdVal: string } {
    if (scope.scope === 'organization') return { scopeName: 'organization', scopeIdVal: organizationId }
    if (scope.scope === 'staff') return { scopeName: 'staff', scopeIdVal: scope.userId }
    if (scope.scope === 'agent') return { scopeName: 'agent', scopeIdVal: scope.agentId }
    return { scopeName: 'contact', scopeIdVal: scope.contactId }
  }

  async function readVirtualColumn(
    backingScope: VirtualBackingScope,
    scopeId: string,
    field: VirtualField,
  ): Promise<string> {
    if (backingScope === 'contact') {
      if (field !== 'profile' && field !== 'memory') return ''
      const rows = await db
        .select({ profile: contacts.profile, memory: contacts.memory })
        .from(contacts)
        .where(and(eq(contacts.organizationId, organizationId), eq(contacts.id, scopeId)))
        .limit(1)
      const row = rows[0] as { profile: string; memory: string } | undefined
      if (!row) throw new Error(`contact not found: ${scopeId}`)
      return row[field] ?? ''
    }
    if (backingScope === 'staff') {
      if (field !== 'profile' && field !== 'memory') return ''
      const rows = await db
        .select({ profile: staffProfiles.profile, memory: staffProfiles.memory })
        .from(staffProfiles)
        .where(and(eq(staffProfiles.organizationId, organizationId), eq(staffProfiles.userId, scopeId)))
        .limit(1)
      const row = rows[0] as { profile: string; memory: string } | undefined
      if (!row) throw new Error(`staff-profile not found: ${scopeId}`)
      return row[field] ?? ''
    }
    // agent
    if (field !== 'instructions' && field !== 'memory') return ''
    const rows = await db
      .select({ instructions: agentDefinitions.instructions, workingMemory: agentDefinitions.workingMemory })
      .from(agentDefinitions)
      .where(and(eq(agentDefinitions.organizationId, organizationId), eq(agentDefinitions.id, scopeId)))
      .limit(1)
    const row = rows[0] as { instructions: string; workingMemory: string } | undefined
    if (!row) throw new Error(`agent not found: ${scopeId}`)
    return (field === 'instructions' ? row.instructions : row.workingMemory) ?? ''
  }

  async function writeVirtualColumn(
    backingScope: VirtualBackingScope,
    scopeId: string,
    field: VirtualField,
    value: string,
  ): Promise<void> {
    if (backingScope === 'contact') {
      if (field !== 'profile' && field !== 'memory') return
      await db
        .update(contacts)
        .set({ [field]: value })
        .where(and(eq(contacts.organizationId, organizationId), eq(contacts.id, scopeId)))
      return
    }
    if (backingScope === 'staff') {
      if (field !== 'profile' && field !== 'memory') return
      await db
        .update(staffProfiles)
        .set({ [field]: value })
        .where(and(eq(staffProfiles.organizationId, organizationId), eq(staffProfiles.userId, scopeId)))
      return
    }
    // agent
    if (field !== 'instructions' && field !== 'memory') return
    const column = field === 'instructions' ? 'instructions' : 'workingMemory'
    await db
      .update(agentDefinitions)
      .set({ [column]: value })
      .where(and(eq(agentDefinitions.organizationId, organizationId), eq(agentDefinitions.id, scopeId)))
  }

  function virtualBackingOf(scope: DriveScope): { backingScope: VirtualBackingScope; id: string } | null {
    if (scope.scope === 'contact') return { backingScope: 'contact', id: scope.contactId }
    if (scope.scope === 'staff') return { backingScope: 'staff', id: scope.userId }
    if (scope.scope === 'agent') return { backingScope: 'agent', id: scope.agentId }
    return null
  }

  /**
   * Fetch the `updatedAt` of the backing row that powers a virtual file. Used
   * to surface a real last-modified timestamp on virtual rows in `listFolder`
   * and `readPath`. Returns `null` when the backing row is missing — callers
   * fall back to `new Date(0)` so the UI still renders deterministically.
   */
  async function readBackingUpdatedAt(backingScope: VirtualBackingScope, scopeId: string): Promise<Date | null> {
    if (backingScope === 'contact') {
      const rows = await db
        .select({ updatedAt: contacts.updatedAt })
        .from(contacts)
        .where(and(eq(contacts.organizationId, organizationId), eq(contacts.id, scopeId)))
        .limit(1)
      const row = rows[0] as { updatedAt: Date } | undefined
      return row?.updatedAt ?? null
    }
    if (backingScope === 'staff') {
      const rows = await db
        .select({ updatedAt: staffProfiles.updatedAt })
        .from(staffProfiles)
        .where(and(eq(staffProfiles.organizationId, organizationId), eq(staffProfiles.userId, scopeId)))
        .limit(1)
      const row = rows[0] as { updatedAt: Date } | undefined
      return row?.updatedAt ?? null
    }
    const rows = await db
      .select({ updatedAt: agentDefinitions.updatedAt })
      .from(agentDefinitions)
      .where(and(eq(agentDefinitions.organizationId, organizationId), eq(agentDefinitions.id, scopeId)))
      .limit(1)
    const row = rows[0] as { updatedAt: Date } | undefined
    return row?.updatedAt ?? null
  }

  /**
   * Synthesize a DriveFile-shaped stub for a provider-owned virtual path —
   * used as the `file` field on `ReadPathResult` when an overlay provider
   * answers a read. Providers that supply a real `updatedAt` thread it through
   * here; otherwise we fall back to epoch (the UI renders that as `—`).
   */
  function providerVirtualStub(
    providerId: string,
    scope: DriveScope,
    path: string,
    updatedAt: Date = new Date(0),
  ): DriveFile {
    const { scopeIdVal } = scopeId(scope)
    const parts = path.split('/').filter(Boolean)
    const name = parts[parts.length - 1] ?? ''
    // Invariant: provider rows never run in 'organization' scope today.
    if (scope.scope === 'organization') {
      throw new Error('drive: provider rows not supported in organization scope')
    }
    const scopeForRow: VirtualBackingScope = scope.scope
    return {
      id: `virtual:provider:${providerId}:${scopeIdVal}:${path}`,
      organizationId,
      scope: scopeForRow,
      scopeId: scopeIdVal,
      parentFolderId: null,
      kind: 'file',
      name,
      path,
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
      createdAt: updatedAt,
      updatedAt,
    }
  }

  async function getByPath(scope: DriveScope, path: string): Promise<DriveFile | null> {
    const { scopeName, scopeIdVal } = scopeId(scope)

    const rows = await db
      .select()
      .from(driveFiles)
      .where(
        and(
          eq(driveFiles.organizationId, organizationId),
          eq(driveFiles.scope, scopeName),
          eq(driveFiles.scopeId, scopeIdVal),
          eq(driveFiles.path, path),
        ),
      )
      .limit(1)
    return (rows[0] as DriveFile) ?? null
  }

  async function listFolder(scope: DriveScope, parentId: string | null): Promise<DriveFile[]> {
    const { scopeName, scopeIdVal } = scopeId(scope)

    const rows = (await db
      .select()
      .from(driveFiles)
      .where(
        and(
          eq(driveFiles.organizationId, organizationId),
          eq(driveFiles.scope, scopeName),
          eq(driveFiles.scopeId, scopeIdVal),
          parentId ? eq(driveFiles.parentFolderId, parentId) : isNull(driveFiles.parentFolderId),
        ),
      )) as DriveFile[]

    const providers = listOverlayProviders(scope.scope)

    // Fan out provider.list() in parallel — each may do 1-2 DB queries, so
    // serial fan-out adds RTTs to every Drive render. Per-provider try/catch
    // preserves failure isolation: a throwing provider must not poison the
    // union.
    const providerResults = await Promise.all(
      providers.map(async (provider) => {
        try {
          return await provider.list({ scope, parentId, organizationId })
        } catch (err) {
          console.error('[drive/overlays] provider.list failed', { providerId: provider.id, err })
          return [] as DriveFile[]
        }
      }),
    )

    const providerRows: DriveFile[] = providerResults.flat()

    if (providerRows.length === 0) return rows

    // Real-row precedence: any synthetic row whose `path` matches a real row
    // is dropped. Provider-vs-provider precedence: first-registered wins —
    // drive registers built-ins (PROFILE/MEMORY/AGENTS) first, so a rogue
    // provider can't double-stamp a builtin path.
    const realPaths = new Set(rows.map((r) => r.path))
    const seenProviderPaths = new Set<string>()
    const dedupedProviderRows: DriveFile[] = []
    for (const r of providerRows) {
      if (realPaths.has(r.path)) continue
      if (seenProviderPaths.has(r.path)) continue
      seenProviderPaths.add(r.path)
      dedupedProviderRows.push(r)
    }

    return [...dedupedProviderRows, ...rows]
  }

  async function readContent(id: string): Promise<{ content: string; spilledToPath?: string }> {
    const parsed = parseVirtualId(id)
    if (parsed) {
      if (parsed.kind === 'builtin') {
        const body = await readVirtualColumn(parsed.backingScope, parsed.scopeIdVal, parsed.field)
        return { content: composeVirtualContent(parsed.field, body, parsed.backingScope) }
      }
      throw new Error(`drive/files: cannot read provider virtual id directly via readContent — use readPath. id=${id}`)
    }

    const rows = await db.select().from(driveFiles).where(eq(driveFiles.id, id)).limit(1)
    const row = rows[0] as DriveFile | undefined
    if (!row) throw new Error(`drive file not found: ${id}`)

    const content = row.extractedText ?? ''
    return { content }
  }

  async function readPath(scope: DriveScope, path: string): Promise<ReadPathResult | null> {
    const vf = resolveVirtualField(scope, path)
    const backing = virtualBackingOf(scope)
    if (vf && backing) {
      const real = await getByPath(scope, path)
      if (real) {
        const { content } = await readContent(real.id)
        return { content, virtual: false, file: real }
      }
      const body = await readVirtualColumn(backing.backingScope, backing.id, vf)
      const backingUpdatedAt = (await readBackingUpdatedAt(backing.backingScope, backing.id)) ?? new Date(0)
      return {
        content: composeVirtualContent(vf, body, backing.backingScope),
        virtual: true,
        file: virtualDriveFile(organizationId, backing.backingScope, backing.id, vf, backingUpdatedAt),
      }
    }
    const real = await getByPath(scope, path)
    if (real) {
      const { content } = await readContent(real.id)
      return { content, virtual: false, file: real }
    }

    // Walk overlay providers; first non-null read wins. Failures isolated.
    for (const provider of listOverlayProviders(scope.scope)) {
      try {
        const result = await provider.read({ scope, path, organizationId })
        if (result) {
          return {
            content: result.content,
            virtual: true,
            file: providerVirtualStub(provider.id, scope, path, result.updatedAt ?? new Date(0)),
          }
        }
      } catch (err) {
        console.error('[drive/overlays] provider.read failed', { providerId: provider.id, err })
      }
    }
    return null
  }

  async function writePath(scope: DriveScope, path: string, content: string): Promise<DriveFile | null> {
    const vf = resolveVirtualField(scope, path)
    const backing = virtualBackingOf(scope)
    if (vf && backing) {
      const body = stripVirtualHeader(content)
      await writeVirtualColumn(backing.backingScope, backing.id, vf, body)
      // Re-read backing updatedAt after the write so the returned virtual row
      // carries the post-mutation timestamp (the underlying tables use
      // `$onUpdate(() => new Date())`).
      const backingUpdatedAt = (await readBackingUpdatedAt(backing.backingScope, backing.id)) ?? new Date()
      return virtualDriveFile(organizationId, backing.backingScope, backing.id, vf, backingUpdatedAt)
    }
    // Real drive file: create-or-update at the path.
    const existing = await getByPath(scope, path)

    if (existing) {
      const rows = (await db
        .update(driveFiles)
        .set({ extractedText: content })
        .where(eq(driveFiles.id, existing.id))
        .returning()) as DriveFile[]
      return rows[0] ?? null
    }
    return create(scope, {
      kind: 'file',
      name: basenameOf(path),
      path,
      mimeType: 'text/markdown',
      extractedText: content,
      parentFolderId: await resolveParentFolderId(scope, path),
    })
  }

  async function getBusinessMd(): Promise<string> {
    const file = await getByPath({ scope: 'organization' }, '/BUSINESS.md')
    if (!file) return BUSINESS_MD_FALLBACK
    const { content } = await readContent(file.id)
    return content || BUSINESS_MD_FALLBACK
  }

  async function get(id: string): Promise<DriveFile | null> {
    const rows = await db
      .select()
      .from(driveFiles)
      .where(and(eq(driveFiles.organizationId, organizationId), eq(driveFiles.id, id)))
      .limit(1)
    return (rows[0] as DriveFile) ?? null
  }

  async function resolveParentFolderId(scope: DriveScope, path: string): Promise<string | null> {
    const parent = parentPathOf(path)
    if (!parent) return null
    const row = await getByPath(scope, parent)
    if (!row) throw new Error(`parent folder does not exist: ${parent}`)
    if (row.kind !== 'folder') throw new Error(`parent is not a folder: ${parent}`)
    return row.id
  }

  async function create(scope: DriveScope, input: CreateFileInput): Promise<DriveFile> {
    const { scopeName, scopeIdVal } = scopeId(scope)
    const parentFolderId =
      input.parentFolderId === undefined ? await resolveParentFolderId(scope, input.path) : input.parentFolderId
    const rows = (await db
      .insert(driveFiles)
      .values({
        organizationId,
        scope: scopeName,
        scopeId: scopeIdVal,
        parentFolderId,
        kind: input.kind,
        name: input.name,
        path: input.path,
        mimeType: input.mimeType ?? null,
        sizeBytes: input.sizeBytes ?? null,
        storageKey: input.storageKey ?? null,
        extractedText: input.extractedText ?? null,
        caption: input.caption ?? null,
        source: input.source ?? null,
        sourceMessageId: input.sourceMessageId ?? null,
        tags: input.tags ?? [],
        uploadedBy: input.uploadedBy ?? null,
      })
      .returning()) as DriveFile[]
    const row = rows[0]
    if (!row) throw new Error('drive/files.create: insert returned no rows')
    return row
  }

  async function mkdir(scope: DriveScope, path: string): Promise<DriveFile> {
    const existing = await getByPath(scope, path)
    if (existing) {
      if (existing.kind !== 'folder') throw new Error(`path exists and is not a folder: ${path}`)
      return existing
    }
    return create(scope, {
      kind: 'folder',
      name: basenameOf(path),
      path,
      parentFolderId: await resolveParentFolderId(scope, path),
    })
  }

  async function move(id: string, newPath: string): Promise<DriveFile> {
    const current = await get(id)
    if (!current) throw new Error(`drive file not found: ${id}`)
    const scope: DriveScope =
      current.scope === 'organization'
        ? { scope: 'organization' }
        : current.scope === 'staff'
          ? { scope: 'staff', userId: current.scopeId }
          : current.scope === 'agent'
            ? { scope: 'agent', agentId: current.scopeId }
            : { scope: 'contact', contactId: current.scopeId }
    const parentFolderId = await resolveParentFolderId(scope, newPath)
    const rows = (await db
      .update(driveFiles)
      .set({ path: newPath, name: basenameOf(newPath), parentFolderId })
      .where(eq(driveFiles.id, id))
      .returning()) as DriveFile[]
    const row = rows[0]
    if (!row) throw new Error(`drive/files.move: update returned no rows for id ${id}`)
    return row
  }

  async function remove(id: string): Promise<void> {
    await db.delete(driveFiles).where(and(eq(driveFiles.organizationId, organizationId), eq(driveFiles.id, id)))
  }

  // biome-ignore lint/suspicious/useAwait: contract requires async signature
  async function grep(_scope: DriveScope, _pattern: string, _opts?: GrepOpts): Promise<GrepMatch[]> {
    throw new Error('not-implemented-in-phase-1: drive/files.grep')
  }

  // biome-ignore lint/suspicious/useAwait: contract requires async signature
  async function ingestUpload(_input: IngestUploadInput): Promise<DriveFile> {
    throw new Error('not-implemented-in-phase-1: drive/files.ingestUpload')
  }

  // biome-ignore lint/suspicious/useAwait: contract requires async signature
  async function saveInboundMessageAttachment(_msgId: string, _targetPath?: string): Promise<DriveFile> {
    throw new Error('not-implemented-in-phase-1: drive/files.saveInboundMessageAttachment')
  }

  // biome-ignore lint/suspicious/useAwait: contract requires async signature
  async function deleteScope(_scope: 'contact' | 'staff', _scopeId: string): Promise<void> {
    throw new Error('not-implemented-in-phase-1: drive/files.deleteScope')
  }

  return {
    getByPath,
    listFolder,
    readContent,
    readPath,
    writePath,
    getBusinessMd,
    get,
    grep,
    create,
    mkdir,
    move,
    remove,
    ingestUpload,
    saveInboundMessageAttachment,
    deleteScope,
  }
}

/**
 * Module-level db + auth handles — installed once by the drive module at boot
 * so HTTP handlers (which see `organizationId` per-request) can construct a
 * bound `FilesService` via `filesServiceFor(organizationId)` and read the
 * better-auth handle via `getDriveAuth()`.
 *
 * Tests call `setFilesDb(db.db)` directly without auth (auth-gated reads
 * fall back to the no-auth path).
 */
let _currentDb: unknown = null
let _currentAuth: unknown = null

export function setFilesDb(db: unknown, auth: unknown = null): void {
  _currentDb = db
  _currentAuth = auth
}

export function getDriveAuth(): unknown {
  return _currentAuth
}

export function __resetFilesDbForTests(): void {
  _currentDb = null
  _currentAuth = null
}

export function filesServiceFor(organizationId: string): FilesService {
  if (!_currentDb) {
    throw new Error('drive/files: db not installed — call setFilesDb() in module init')
  }
  return createFilesService({ db: _currentDb, organizationId })
}
