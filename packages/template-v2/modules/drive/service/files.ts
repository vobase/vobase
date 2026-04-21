/**
 * Drive files service — factory-DI, scope-partitioned by (scope, scope_id).
 *
 * Real reads: getByPath, listFolder, readContent, getBusinessMd, get.
 * Real writes: create, mkdir, move, remove.
 *
 * Virtual overlay (`contact` + `staff` scopes):
 *   - `/PROFILE.md` ↔ `contacts.profile` / `staff_profiles.profile`
 *   - `/NOTES.md`   ↔ `contacts.notes`   / `staff_profiles.notes`
 *
 * `readPath` / `writePath` unify real + virtual. Virtual reads prepend a
 * single-line sentinel header; virtual writes strip any sentinel lines before
 * persisting to the backing column. `listFolder` at root surfaces the two
 * virtual entries even when no `drive.files` rows exist.
 *
 * `grep`, `ingestUpload`, `saveInboundMessageAttachment`, `deleteScope` remain
 * stubbed — covered by later slices.
 */
import type { DriveFile } from '../schema'
import type { CreateFileInput, DriveScope, GrepMatch, GrepOpts, IngestUploadInput } from './types'

/** Fallback content when /BUSINESS.md is absent from the drive. */
export const BUSINESS_MD_FALLBACK = 'No business profile configured. Ask staff to create /BUSINESS.md in the drive.'

/** Sentinel line prepended to virtual-file reads; stripped on write. */
const VIRTUAL_HEADER_PREFIX = '<!-- drive:virtual'
const virtualHeader = (scope: 'contact' | 'staff', field: 'profile' | 'notes'): string => {
  const source = scope === 'contact' ? `contacts.${field}` : `staff_profiles.${field}`
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

/** If `(scope, path)` is a contact or staff virtual path, return the backing column name. */
export function resolveVirtualField(scope: DriveScope, path: string): 'profile' | 'notes' | null {
  if (scope.scope !== 'contact' && scope.scope !== 'staff') return null
  if (path === '/PROFILE.md') return 'profile'
  if (path === '/NOTES.md') return 'notes'
  return null
}

/** @deprecated — use `resolveVirtualField`. Retained for tests and compatibility. */
export function resolveContactVirtualField(scope: DriveScope, path: string): 'profile' | 'notes' | null {
  if (scope.scope !== 'contact') return null
  return resolveVirtualField(scope, path)
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
  field: 'profile' | 'notes',
  body: string,
  backingScope: 'contact' | 'staff' = 'contact',
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

function virtualDriveFile(
  organizationId: string,
  backingScope: 'contact' | 'staff',
  scopeId: string,
  field: 'profile' | 'notes',
): DriveFile {
  const name = field === 'profile' ? 'PROFILE.md' : 'NOTES.md'
  const now = new Date(0)
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
    createdAt: now,
    updatedAt: now,
  }
}

export function createFilesService(deps: FilesServiceDeps): FilesService {
  const db = deps.db as FilesDb
  const organizationId = deps.organizationId

  function scopeId(scope: DriveScope): { scopeName: string; scopeIdVal: string } {
    if (scope.scope === 'organization') return { scopeName: 'organization', scopeIdVal: organizationId }
    if (scope.scope === 'staff') return { scopeName: 'staff', scopeIdVal: scope.userId }
    return { scopeName: 'contact', scopeIdVal: scope.contactId }
  }

  async function readVirtualColumn(
    backingScope: 'contact' | 'staff',
    scopeId: string,
    field: 'profile' | 'notes',
  ): Promise<string> {
    if (backingScope === 'contact') {
      const { contacts } = await import('@modules/contacts/schema')
      const { and, eq } = await import('drizzle-orm')
      const rows = await db
        .select({ profile: contacts.profile, notes: contacts.notes })
        .from(contacts)
        .where(and(eq(contacts.organizationId, organizationId), eq(contacts.id, scopeId)))
        .limit(1)
      const row = rows[0] as { profile: string; notes: string } | undefined
      if (!row) throw new Error(`contact not found: ${scopeId}`)
      return row[field] ?? ''
    }
    const { staffProfiles } = await import('@modules/team/schema')
    const { and, eq } = await import('drizzle-orm')
    const rows = await db
      .select({ profile: staffProfiles.profile, notes: staffProfiles.notes })
      .from(staffProfiles)
      .where(and(eq(staffProfiles.organizationId, organizationId), eq(staffProfiles.userId, scopeId)))
      .limit(1)
    const row = rows[0] as { profile: string; notes: string } | undefined
    if (!row) throw new Error(`staff-profile not found: ${scopeId}`)
    return row[field] ?? ''
  }

  async function writeVirtualColumn(
    backingScope: 'contact' | 'staff',
    scopeId: string,
    field: 'profile' | 'notes',
    value: string,
  ): Promise<void> {
    if (backingScope === 'contact') {
      const { contacts } = await import('@modules/contacts/schema')
      const { and, eq } = await import('drizzle-orm')
      await db
        .update(contacts)
        .set({ [field]: value })
        .where(and(eq(contacts.organizationId, organizationId), eq(contacts.id, scopeId)))
      return
    }
    const { staffProfiles } = await import('@modules/team/schema')
    const { and, eq } = await import('drizzle-orm')
    await db
      .update(staffProfiles)
      .set({ [field]: value })
      .where(and(eq(staffProfiles.organizationId, organizationId), eq(staffProfiles.userId, scopeId)))
  }

  function virtualBackingOf(scope: DriveScope): { backingScope: 'contact' | 'staff'; id: string } | null {
    if (scope.scope === 'contact') return { backingScope: 'contact', id: scope.contactId }
    if (scope.scope === 'staff') return { backingScope: 'staff', id: scope.userId }
    return null
  }

  async function getByPath(scope: DriveScope, path: string): Promise<DriveFile | null> {
    const { driveFiles } = await import('@modules/drive/schema')
    const { eq, and } = await import('drizzle-orm')
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
    const { driveFiles } = await import('@modules/drive/schema')
    const { eq, and, isNull } = await import('drizzle-orm')
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

    const backing = virtualBackingOf(scope)
    if (backing && parentId === null) {
      const realNames = new Set(rows.map((r) => r.name))
      const overlays: DriveFile[] = []
      if (!realNames.has('PROFILE.md')) {
        overlays.push(virtualDriveFile(organizationId, backing.backingScope, backing.id, 'profile'))
      }
      if (!realNames.has('NOTES.md')) {
        overlays.push(virtualDriveFile(organizationId, backing.backingScope, backing.id, 'notes'))
      }
      return [...overlays, ...rows]
    }
    return rows
  }

  async function readContent(id: string): Promise<{ content: string; spilledToPath?: string }> {
    if (id.startsWith('virtual:')) {
      const [, backingScope, scopeIdVal, field] = id.split(':') as [
        string,
        'contact' | 'staff',
        string,
        'profile' | 'notes',
      ]
      const body = await readVirtualColumn(backingScope, scopeIdVal, field)
      return { content: composeVirtualContent(field, body, backingScope) }
    }
    const { driveFiles } = await import('@modules/drive/schema')
    const { eq } = await import('drizzle-orm')

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
      return {
        content: composeVirtualContent(vf, body, backing.backingScope),
        virtual: true,
        file: virtualDriveFile(organizationId, backing.backingScope, backing.id, vf),
      }
    }
    const real = await getByPath(scope, path)
    if (!real) return null
    const { content } = await readContent(real.id)
    return { content, virtual: false, file: real }
  }

  async function writePath(scope: DriveScope, path: string, content: string): Promise<DriveFile | null> {
    const vf = resolveVirtualField(scope, path)
    const backing = virtualBackingOf(scope)
    if (vf && backing) {
      const body = stripVirtualHeader(content)
      await writeVirtualColumn(backing.backingScope, backing.id, vf, body)
      return virtualDriveFile(organizationId, backing.backingScope, backing.id, vf)
    }
    // Real drive file: create-or-update at the path.
    const existing = await getByPath(scope, path)
    const { driveFiles } = await import('@modules/drive/schema')
    const { eq } = await import('drizzle-orm')

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
    const { driveFiles } = await import('@modules/drive/schema')
    const { eq, and } = await import('drizzle-orm')
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
    const { driveFiles } = await import('@modules/drive/schema')
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
          : { scope: 'contact', contactId: current.scopeId }
    const parentFolderId = await resolveParentFolderId(scope, newPath)
    const { driveFiles } = await import('@modules/drive/schema')
    const { eq } = await import('drizzle-orm')
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
    const { driveFiles } = await import('@modules/drive/schema')
    const { eq, and } = await import('drizzle-orm')
    await db.delete(driveFiles).where(and(eq(driveFiles.organizationId, organizationId), eq(driveFiles.id, id)))
  }

  async function grep(_scope: DriveScope, _pattern: string, _opts?: GrepOpts): Promise<GrepMatch[]> {
    throw new Error('not-implemented-in-phase-1: drive/files.grep')
  }

  async function ingestUpload(_input: IngestUploadInput): Promise<DriveFile> {
    throw new Error('not-implemented-in-phase-1: drive/files.ingestUpload')
  }

  async function saveInboundMessageAttachment(_msgId: string, _targetPath?: string): Promise<DriveFile> {
    throw new Error('not-implemented-in-phase-1: drive/files.saveInboundMessageAttachment')
  }

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
 * Module-level db handle — installed once by the drive module at boot so HTTP
 * handlers (which see `organizationId` per-request) can construct a bound
 * `FilesService` via `filesServiceFor(organizationId)`.
 *
 * Compatibility shim mirroring the `setDb` pattern used by `agents/journal` +
 * `agents/agent-definitions`. Tests call `setFilesDb(db.db)` directly.
 */
let _currentDb: unknown = null
let _currentAuth: unknown = null

export function setFilesDb(db: unknown): void {
  _currentDb = db
}

/** Installed by `server/auth/wire-modules.ts` after `createAuth(db)`. */
export function installDriveAuth(auth: unknown): void {
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
