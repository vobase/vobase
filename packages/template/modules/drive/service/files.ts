/**
 * Drive files service — factory-DI, scope-partitioned by (scope, scope_id).
 *
 * Real reads: getByPath, listFolder, readContent, getBusinessMd, get.
 * Real writes: create, mkdir, move, remove, ingestUpload, requestCaption,
 *              reextract, reapStalePending.
 * Search: searchDrive (hybrid pgvector + tsvector).
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
 * `grep` and `deleteScope` remain stubbed — covered by later slices.
 */

import { agentDefinitions } from '@modules/agents/schema'
import { contacts } from '@modules/contacts/schema'
import { driveChunks, driveFiles } from '@modules/drive/schema'
import { staffProfiles } from '@modules/team/schema'
import { and, eq, inArray, isNull, lt, or, sql } from 'drizzle-orm'

import type { AppStorage, RealtimeService } from '~/runtime'
import { INBOUND_TO_WAKE_JOB } from '~/wake/inbound'
import {
  DRIVE_PROCESS_FILE_JOB,
  DRIVE_REAPER_STALE_MS,
  DRIVE_STORAGE_BUCKET,
  REQUEST_CAPTION_MAX_BYTES,
} from '../constants'
import { deriveDriveName } from '../lib/drive-name'
import { embedTexts, encodeVector } from '../lib/embeddings'
import { hybridScore } from '../lib/search'
import type { DriveFile } from '../schema'
import { listOverlayProviders } from './overlays'
import type {
  CreateFileInput,
  DriveScope,
  GrepMatch,
  GrepOpts,
  IngestUploadInput,
  IngestUploadResult,
  RequestCaptionInput,
  RequestCaptionResult,
  SearchDriveHit,
  SearchDriveInput,
} from './types'
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
    } & Promise<unknown[]>
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
  execute: <T>(q: unknown) => Promise<T[]>
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
  /**
   * Auth-agnostic upload entry point. The HTTP handler enforces scope-write
   * RBAC; trusted in-process callers (inbound channel ingestion) skip the
   * gate. Inserts the row, uploads bytes, enqueues `drive:process-file`.
   */
  ingestUpload(input: IngestUploadInput): Promise<IngestUploadResult>
  /**
   * Agent-side action: forces multimodal caption + extraction on a binary-stub
   * row. The job re-wakes the originating conversation when extraction finishes
   * via `INBOUND_TO_WAKE_JOB` with a `caption_ready` trigger.
   */
  requestCaption(input: RequestCaptionInput): Promise<RequestCaptionResult>
  /** Hybrid search across drive chunks; tenant-isolated by `organizationId`. */
  searchDrive(input: SearchDriveInput): Promise<SearchDriveHit[]>
  /** Re-extract a file. Recomputes `path` if mime classification flips. */
  reextract(fileId: string): Promise<void>
  /** Sweep stuck `(pending, *)` rows; safe to call at module init. */
  reapStalePending(): Promise<{ swept: number }>
  deleteScope(scope: 'contact' | 'staff', scopeId: string): Promise<void>
}

/**
 * Minimal pg-boss-shaped scheduler — enough for `ingestUpload` to enqueue
 * `drive:process-file` without dragging pg-boss types into the unit-test path.
 */
export interface FilesScheduler {
  send(
    name: string,
    data: Record<string, unknown>,
    opts?: { startAfter?: Date; singletonKey?: string },
  ): Promise<string>
}

export interface FilesServiceDeps {
  db: unknown
  organizationId: string
  /** Storage adapter (`ctx.storage`); optional for tests that exercise read-only paths only. */
  storage?: AppStorage
  /** Job queue (`ctx.jobs`); optional for tests that don't enqueue. */
  jobs?: FilesScheduler
  /** Realtime fanout (`ctx.realtime`); optional for tests. */
  realtime?: RealtimeService
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
    originalName: null,
    nameStem: null,
    source: null,
    sourceMessageId: null,
    tags: [],
    uploadedBy: null,
    processingStatus: 'ready',
    extractionKind: 'extracted',
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
      originalName: null,
      nameStem: null,
      source: null,
      sourceMessageId: null,
      tags: [],
      uploadedBy: null,
      processingStatus: 'ready',
      extractionKind: 'extracted',
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

  /**
   * `ON CONFLICT (organizationId, scope, scopeId, path)` loop. Tries the
   * candidate, then `<stem> (2).<ext>`, `<stem> (3).<ext>`, … up to 32 attempts
   * before giving up. Returns the resolved unique path.
   */
  async function resolveUniquePath(scope: DriveScope, basePath: string, displayName: string): Promise<string> {
    const safeBase = basePath.endsWith('/') ? basePath : `${basePath}/`
    const dot = displayName.lastIndexOf('.')
    const stem = dot > 0 ? displayName.slice(0, dot) : displayName
    const ext = dot > 0 ? displayName.slice(dot) : ''
    for (let attempt = 1; attempt <= 32; attempt++) {
      const candidate = attempt === 1 ? `${safeBase}${stem}${ext}` : `${safeBase}${stem} (${attempt})${ext}`
      const existing = await getByPath(scope, candidate)
      if (!existing) return candidate
    }
    throw new Error(`drive/files: resolveUniquePath exceeded 32 attempts for ${basePath}${displayName}`)
  }

  function notifyDriveFile(id: string, action: 'created' | 'updated' | 'deleted'): void {
    if (deps.realtime) {
      deps.realtime.notify({ table: 'drive_files', id, action })
    }
  }

  async function ingestUpload(input: IngestUploadInput): Promise<IngestUploadResult> {
    if (!deps.storage) throw new Error('drive/files: storage not installed — pass ctx.storage to setFilesRuntime')
    if (!deps.jobs) throw new Error('drive/files: jobs not installed — pass ctx.jobs to setFilesRuntime')
    const { scopeName, scopeIdVal } = scopeId(input.scope)
    const { nameStem, displayName } = deriveDriveName({
      originalName: input.originalName,
      mimeType: input.mimeType,
    })

    // Overlay collision check — refuse to shadow virtual fields.
    const candidatePath = `${input.basePath.replace(/\/+$/u, '')}/${displayName}`
    if (resolveVirtualField(input.scope, candidatePath) !== null) {
      throw new Error(`overlay_path_collision: cannot upload over virtual path ${candidatePath}`)
    }

    const path = await resolveUniquePath(input.scope, input.basePath, displayName)
    const parentFolderId = await ensureParentFolderId(input.scope, path).catch(() => null)
    const insertedRows = (await db
      .insert(driveFiles)
      .values({
        organizationId: input.organizationId,
        scope: scopeName,
        scopeId: scopeIdVal,
        parentFolderId,
        kind: 'file',
        name: displayName,
        path,
        mimeType: input.mimeType,
        sizeBytes: input.sizeBytes,
        storageKey: null,
        originalName: input.originalName,
        nameStem,
        source: input.source,
        uploadedBy: input.uploadedBy,
        processingStatus: 'pending',
        extractionKind: 'pending',
        tags: [],
      })
      .returning()) as DriveFile[]
    const row = insertedRows[0]
    if (!row) throw new Error('drive/files.ingestUpload: insert returned no rows')

    // Storage upload. On failure mark row terminal-failed (audit trail) and rethrow.
    const storageKey = `${scopeName}/${row.id}/${sanitizeKey(input.originalName)}`
    try {
      await deps.storage.bucket(DRIVE_STORAGE_BUCKET).upload(storageKey, input.bytes, { contentType: input.mimeType })
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err)
      await db
        .update(driveFiles)
        .set({
          processingStatus: 'failed',
          extractionKind: 'failed',
          processingError: `storage_upload_failed: ${msg}`,
        })
        .where(and(eq(driveFiles.organizationId, input.organizationId), eq(driveFiles.id, row.id)))
      notifyDriveFile(row.id, 'updated')
      throw err
    }
    // If the post-upload UPDATE fails, delete the orphan bytes before bailing.
    try {
      await db
        .update(driveFiles)
        .set({ storageKey })
        .where(and(eq(driveFiles.organizationId, input.organizationId), eq(driveFiles.id, row.id)))
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err)
      try {
        await deps.storage.bucket(DRIVE_STORAGE_BUCKET).delete(storageKey)
      } catch {
        // best-effort: orphan bytes is the lesser evil
      }
      await db
        .update(driveFiles)
        .set({
          processingStatus: 'failed',
          extractionKind: 'failed',
          processingError: `storage_key_update_failed: ${msg}`,
        })
        .where(and(eq(driveFiles.organizationId, input.organizationId), eq(driveFiles.id, row.id)))
      notifyDriveFile(row.id, 'updated')
      throw err
    }

    // Enqueue extraction. If this throws, row stays (pending, pending) — reaper sweeps.
    await deps.jobs.send(
      DRIVE_PROCESS_FILE_JOB,
      { fileId: row.id, organizationId: input.organizationId, forceCaption: false },
      { singletonKey: `drive:process:${row.id}` },
    )
    notifyDriveFile(row.id, 'created')
    return { id: row.id, path, nameStem, extractionKind: 'pending' }
  }

  async function ensureParentFolderId(scope: DriveScope, path: string): Promise<string | null> {
    const parent = parentPathOf(path)
    if (!parent) return null
    const row = await getByPath(scope, parent)
    if (row && row.kind === 'folder') return row.id
    if (row) throw new Error(`parent is not a folder: ${parent}`)
    return null
  }

  async function requestCaption(input: RequestCaptionInput): Promise<RequestCaptionResult> {
    if (!deps.jobs) throw new Error('drive/files: jobs not installed — pass ctx.jobs to setFilesRuntime')
    const row = await get(input.fileId)
    if (!row) return { ok: false, error: 'not_found' }
    if (row.organizationId !== input.organizationId) return { ok: false, error: 'not_found' }
    if (row.extractionKind === 'pending' || row.extractionKind === 'failed') {
      return { ok: false, error: 'not a binary file' }
    }
    if (row.extractionKind === 'extracted') {
      // Already-extracted: enqueue an immediate caption_ready wake (no new OCR cost).
      await deps.jobs.send(
        INBOUND_TO_WAKE_JOB,
        {
          organizationId: input.organizationId,
          conversationId: input.conversationId,
          contactId: input.contactId,
          trigger: { trigger: 'caption_ready', conversationId: input.conversationId, fileId: row.id },
        },
        { singletonKey: `drive:caption-ready:${row.id}` },
      )
      return { ok: true, accepted: true, eta_ms: 0 }
    }
    // binary-stub
    if ((row.sizeBytes ?? 0) > REQUEST_CAPTION_MAX_BYTES) {
      return {
        ok: false,
        error: 'file too large for caption',
        sizeBytes: row.sizeBytes ?? 0,
        maxBytes: REQUEST_CAPTION_MAX_BYTES,
      }
    }
    await deps.jobs.send(
      DRIVE_PROCESS_FILE_JOB,
      {
        fileId: row.id,
        organizationId: input.organizationId,
        forceCaption: true,
        wakeOnComplete: { conversationId: input.conversationId, contactId: input.contactId },
      },
      { singletonKey: `drive:process:${row.id}` },
    )
    return { ok: true, accepted: true, eta_ms: 30_000 }
  }

  async function searchDrive(input: SearchDriveInput): Promise<SearchDriveHit[]> {
    if (input.organizationId !== organizationId) {
      // Defensive — service is bound to one org; mismatch indicates wiring bug.
      throw new Error('drive/files.searchDrive: organizationId mismatch')
    }
    const limit = input.limit ?? 10

    // Vector + keyword candidates run in parallel; vector falls back to empty
    // when no OPENAI key is set so keyword still drives the result set.
    const [vectorCandidates, keywordCandidates] = await Promise.all([
      runVectorSearch(input.query, input.scope, limit * 3).catch(() => []),
      runKeywordSearch(input.query, input.scope, limit * 3).catch(() => []),
    ])

    const byChunk = new Map<string, { chunkId: string; cosineDistance: number; tsRank: number }>()
    for (const v of vectorCandidates)
      byChunk.set(v.chunkId, { chunkId: v.chunkId, cosineDistance: v.cosineDistance, tsRank: 0 })
    for (const k of keywordCandidates) {
      const existing = byChunk.get(k.chunkId)
      if (existing) existing.tsRank = k.tsRank
      else byChunk.set(k.chunkId, { chunkId: k.chunkId, cosineDistance: 1, tsRank: k.tsRank })
    }
    const ranked = [...byChunk.values()]
      .map((c) => ({ ...c, score: hybridScore({ cosineDistance: c.cosineDistance, tsRank: c.tsRank }) }))
      .sort((a, b) => b.score - a.score)
      .slice(0, limit)

    if (ranked.length === 0) return []

    const chunkIds = ranked.map((r) => r.chunkId)
    const chunkRows = (await db
      .select()
      .from(driveChunks)
      .where(and(eq(driveChunks.organizationId, organizationId), inArray(driveChunks.id, chunkIds)))) as Array<{
      id: string
      fileId: string
      chunkIndex: number
      content: string
    }>
    const chunkById = new Map(chunkRows.map((c) => [c.id, c]))
    const fileIds = [...new Set(chunkRows.map((c) => c.fileId))]
    const fileRows =
      fileIds.length > 0
        ? ((await db
            .select()
            .from(driveFiles)
            .where(and(eq(driveFiles.organizationId, organizationId), inArray(driveFiles.id, fileIds)))) as DriveFile[])
        : []
    const fileById = new Map(fileRows.map((f) => [f.id, f]))
    const hits: SearchDriveHit[] = []
    for (const r of ranked) {
      const chunk = chunkById.get(r.chunkId)
      if (!chunk) continue
      const file = fileById.get(chunk.fileId)
      if (!file) continue
      hits.push({
        fileId: file.id,
        path: file.path,
        caption: file.caption,
        chunkIndex: chunk.chunkIndex,
        excerpt: chunk.content.slice(0, 240),
        score: r.score,
      })
    }
    return hits
  }

  /** Run pgvector cosine-distance search; returns chunkId + distance. */
  async function runVectorSearch(
    query: string,
    scope: DriveScope | undefined,
    fetchN: number,
  ): Promise<Array<{ chunkId: string; cosineDistance: number }>> {
    const embedded = await embedQueryIfPossible(query)
    if (!embedded) return []
    const vec = encodeVector(embedded)
    const scopeFilter = scope
      ? sql`AND scope = ${scopeId(scope).scopeName} AND scope_id = ${scopeId(scope).scopeIdVal}`
      : sql``
    const rows = (await db.execute<{ id: string; distance: number }>(
      sql`SELECT id, embedding <=> ${vec}::vector AS distance
          FROM drive.chunks
          WHERE organization_id = ${organizationId}
          ${scopeFilter}
          ORDER BY embedding <=> ${vec}::vector
          LIMIT ${fetchN}`,
    )) as Array<{ id: string; distance: number }>
    return rows.map((r) => ({ chunkId: r.id, cosineDistance: Number(r.distance) }))
  }

  /** Run tsvector keyword search; returns chunkId + ts_rank. */
  async function runKeywordSearch(
    query: string,
    scope: DriveScope | undefined,
    fetchN: number,
  ): Promise<Array<{ chunkId: string; tsRank: number }>> {
    const scopeFilter = scope
      ? sql`AND scope = ${scopeId(scope).scopeName} AND scope_id = ${scopeId(scope).scopeIdVal}`
      : sql``
    const rows = (await db.execute<{ id: string; rank: number }>(
      sql`SELECT id, ts_rank(tsv, websearch_to_tsquery('english', ${query})) AS rank
          FROM drive.chunks
          WHERE organization_id = ${organizationId}
            AND tsv @@ websearch_to_tsquery('english', ${query})
          ${scopeFilter}
          ORDER BY rank DESC
          LIMIT ${fetchN}`,
    )) as Array<{ id: string; rank: number }>
    return rows.map((r) => ({ chunkId: r.id, tsRank: Number(r.rank) }))
  }

  /** Wraps `embedTexts` for query embedding; returns null if the embedder is unavailable. */
  async function embedQueryIfPossible(query: string): Promise<number[] | null> {
    if (!process.env.OPENAI_API_KEY) return null
    try {
      const { embeddings } = await embedTexts([query])
      return embeddings[0] ?? null
    } catch {
      return null
    }
  }

  async function reextract(fileId: string): Promise<void> {
    if (!deps.jobs) throw new Error('drive/files: jobs not installed — pass ctx.jobs to setFilesRuntime')
    const row = await get(fileId)
    if (!row) throw new Error(`drive/files.reextract: not found: ${fileId}`)
    // Recompute path if mime classification flipped; `nameStem` and `originalName` stay frozen.
    const patch: Partial<DriveFile> = {
      processingStatus: 'pending',
      extractionKind: 'pending',
      processingError: null,
    }
    if (row.originalName && row.mimeType) {
      const { displayName } = deriveDriveName({ originalName: row.originalName, mimeType: row.mimeType })
      const lastSlash = row.path.lastIndexOf('/')
      const basePath = lastSlash >= 0 ? row.path.slice(0, lastSlash + 1) : '/'
      const candidate = `${basePath}${displayName}`
      if (candidate !== row.path) {
        patch.path = candidate
        patch.name = displayName
      }
    }
    await db
      .update(driveFiles)
      .set(patch)
      .where(and(eq(driveFiles.organizationId, organizationId), eq(driveFiles.id, fileId)))
    await deps.jobs.send(
      DRIVE_PROCESS_FILE_JOB,
      { fileId, organizationId, forceCaption: false },
      { singletonKey: `drive:process:${fileId}` },
    )
    notifyDriveFile(fileId, 'updated')
  }

  async function reapStalePending(): Promise<{ swept: number }> {
    if (!deps.jobs) return { swept: 0 }
    const cutoff = new Date(Date.now() - DRIVE_REAPER_STALE_MS)
    const stale = (await db
      .select()
      .from(driveFiles)
      .where(
        and(
          eq(driveFiles.organizationId, organizationId),
          eq(driveFiles.extractionKind, 'pending'),
          or(eq(driveFiles.processingStatus, 'pending'), eq(driveFiles.processingStatus, 'processing')),
          lt(driveFiles.updatedAt, cutoff),
        ),
      )) as DriveFile[]
    let swept = 0
    for (const row of stale) {
      await db
        .update(driveFiles)
        .set({ processingStatus: 'pending' })
        .where(and(eq(driveFiles.organizationId, organizationId), eq(driveFiles.id, row.id)))
      await deps.jobs.send(
        DRIVE_PROCESS_FILE_JOB,
        { fileId: row.id, organizationId, forceCaption: false },
        { singletonKey: `drive:process:${row.id}` },
      )
      swept++
    }
    return { swept }
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
    requestCaption,
    searchDrive,
    reextract,
    reapStalePending,
    deleteScope,
  }
}

/** Sanitize a filename for use as a storage key (preserve extension). */
function sanitizeKey(name: string): string {
  return name.replace(/[^a-zA-Z0-9._-]/gu, '_')
}

/**
 * Module-level handles — installed once by the drive module at boot so HTTP
 * handlers (which see `organizationId` per-request) can construct a bound
 * `FilesService` via `filesServiceFor(organizationId)`. Auth is read by drive
 * scope-RBAC middleware via `getDriveAuth()`.
 *
 * `setFilesDb` is a back-compat alias kept for test code that doesn't enqueue
 * jobs / upload bytes. New code should call `setFilesRuntime`.
 */
let _currentDb: unknown = null
let _currentAuth: unknown = null
let _currentStorage: AppStorage | null = null
let _currentJobs: FilesScheduler | null = null
let _currentRealtime: RealtimeService | null = null

/**
 * Install the drive runtime handles. Production callers (module `init`) pass
 * all five; test code typically passes only `db` (and optionally `auth`).
 */
export function setFilesRuntime(
  db: unknown,
  auth: unknown,
  storage: AppStorage | null,
  jobs: FilesScheduler | null,
  realtime: RealtimeService | null,
): void {
  _currentDb = db
  _currentAuth = auth
  _currentStorage = storage
  _currentJobs = jobs
  _currentRealtime = realtime
}

/** Back-compat alias for tests that only need read paths. */
export function setFilesDb(db: unknown, auth: unknown = null): void {
  setFilesRuntime(db, auth, null, null, null)
}

export function getDriveAuth(): unknown {
  return _currentAuth
}

/** Storage handle accessor — used by HTTP handlers that stream raw bytes. */
export function getDriveStorage(): AppStorage | null {
  return _currentStorage
}

export function __resetFilesDbForTests(): void {
  _currentDb = null
  _currentAuth = null
  _currentStorage = null
  _currentJobs = null
  _currentRealtime = null
}

export function filesServiceFor(organizationId: string): FilesService {
  if (!_currentDb) {
    throw new Error('drive/files: db not installed — call setFilesRuntime() in module init')
  }
  return createFilesService({
    db: _currentDb,
    organizationId,
    storage: _currentStorage ?? undefined,
    jobs: _currentJobs ?? undefined,
    realtime: _currentRealtime ?? undefined,
  })
}
