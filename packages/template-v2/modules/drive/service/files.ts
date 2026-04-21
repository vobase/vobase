/**
 * REAL Phase 1 — getByPath, listFolder, readContent, getBusinessMd.
 * All write methods throw not-implemented-in-phase-1.
 *
 * Factory-DI service. `createFilesService({ db, organizationId })`
 * returns the bound API.
 */
import type { DriveFile } from '../schema'
import type { CreateFileInput, DriveScope, GrepMatch, GrepOpts, IngestUploadInput } from './types'

/** Fallback content when /BUSINESS.md is absent from the drive. */
export const BUSINESS_MD_FALLBACK = 'No business profile configured. Ask staff to create /BUSINESS.md in the drive.'

type FilesDb = {
  select: () => {
    from: (t: unknown) => {
      where: (c: unknown) => {
        limit: (n: number) => Promise<unknown[]>
      } & Promise<unknown[]>
    }
  }
}

export interface FilesService {
  getByPath(scope: DriveScope, path: string): Promise<DriveFile | null>
  listFolder(scope: DriveScope, parentId: string | null): Promise<DriveFile[]>
  readContent(id: string): Promise<{ content: string; spilledToPath?: string }>
  getBusinessMd(): Promise<string>
  get(id: string): Promise<DriveFile | null>
  grep(scope: DriveScope, pattern: string, opts?: GrepOpts): Promise<GrepMatch[]>
  create(scope: DriveScope, input: CreateFileInput): Promise<DriveFile>
  mkdir(scope: DriveScope, path: string): Promise<DriveFile>
  move(id: string, newPath: string): Promise<DriveFile>
  remove(id: string): Promise<void>
  ingestUpload(input: IngestUploadInput): Promise<DriveFile>
  saveInboundMessageAttachment(msgId: string, targetPath?: string): Promise<DriveFile>
  deleteScope(scope: 'contact', scopeId: string): Promise<void>
}

export interface FilesServiceDeps {
  db: unknown
  organizationId: string
}

export function createFilesService(deps: FilesServiceDeps): FilesService {
  const db = deps.db as FilesDb
  const organizationId = deps.organizationId

  function scopeId(scope: DriveScope): { scopeName: string; scopeIdVal: string } {
    if (scope.scope === 'organization') {
      return { scopeName: 'organization', scopeIdVal: organizationId }
    }
    return { scopeName: 'contact', scopeIdVal: scope.contactId }
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

    const rows = await db
      .select()
      .from(driveFiles)
      .where(
        and(
          eq(driveFiles.organizationId, organizationId),
          eq(driveFiles.scope, scopeName),
          eq(driveFiles.scopeId, scopeIdVal),
          parentId ? eq(driveFiles.parentFolderId, parentId) : isNull(driveFiles.parentFolderId),
        ),
      )
    return rows as DriveFile[]
  }

  async function readContent(id: string): Promise<{ content: string; spilledToPath?: string }> {
    const { driveFiles } = await import('@modules/drive/schema')
    const { eq } = await import('drizzle-orm')

    const rows = await db.select().from(driveFiles).where(eq(driveFiles.id, id)).limit(1)
    const row = rows[0] as DriveFile | undefined
    if (!row) throw new Error(`drive file not found: ${id}`)

    const content = row.extractedText ?? ''
    return { content }
  }

  async function getBusinessMd(): Promise<string> {
    const file = await getByPath({ scope: 'organization' }, '/BUSINESS.md')
    if (!file) return BUSINESS_MD_FALLBACK
    const { content } = await readContent(file.id)
    return content || BUSINESS_MD_FALLBACK
  }

  async function get(_id: string): Promise<DriveFile | null> {
    throw new Error('not-implemented-in-phase-1: drive/files.get')
  }

  async function grep(_scope: DriveScope, _pattern: string, _opts?: GrepOpts): Promise<GrepMatch[]> {
    throw new Error('not-implemented-in-phase-1: drive/files.grep')
  }

  async function create(_scope: DriveScope, _input: CreateFileInput): Promise<DriveFile> {
    throw new Error('not-implemented-in-phase-1: drive/files.create')
  }

  async function mkdir(_scope: DriveScope, _path: string): Promise<DriveFile> {
    throw new Error('not-implemented-in-phase-1: drive/files.mkdir')
  }

  async function move(_id: string, _newPath: string): Promise<DriveFile> {
    throw new Error('not-implemented-in-phase-1: drive/files.move')
  }

  async function remove(_id: string): Promise<void> {
    throw new Error('not-implemented-in-phase-1: drive/files.remove')
  }

  async function ingestUpload(_input: IngestUploadInput): Promise<DriveFile> {
    throw new Error('not-implemented-in-phase-1: drive/files.ingestUpload')
  }

  async function saveInboundMessageAttachment(_msgId: string, _targetPath?: string): Promise<DriveFile> {
    throw new Error('not-implemented-in-phase-1: drive/files.saveInboundMessageAttachment')
  }

  async function deleteScope(_scope: 'contact', _scopeId: string): Promise<void> {
    throw new Error('not-implemented-in-phase-1: drive/files.deleteScope')
  }

  return {
    getByPath,
    listFolder,
    readContent,
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
