/**
 * REAL Phase 1 — getByPath, listFolder, readContent, getBusinessMd.
 * All write methods throw not-implemented-in-phase-1.
 */
import type { DriveFile } from '@server/contracts/domain-types'
import type { CreateFileInput, DriveScope, GrepMatch, GrepOpts, IngestUploadInput } from '@server/contracts/drive-port'

/** Fallback content when /BUSINESS.md is absent from the drive. */
export const BUSINESS_MD_FALLBACK = 'No business profile configured. Ask staff to create /BUSINESS.md in the drive.'

let _db: unknown = null

export function setDb(db: unknown): void {
  _db = db
}

function requireDb(): unknown {
  if (!_db) throw new Error('drive/files: db not initialised — call setDb() in module init')
  return _db
}

function scopeId(scope: DriveScope, organizationId: string): { scopeName: string; scopeIdVal: string } {
  if (scope.scope === 'organization') {
    return { scopeName: 'organization', scopeIdVal: organizationId }
  }
  return { scopeName: 'contact', scopeIdVal: scope.contactId }
}

/** Injected organizationId — set by module init from ctx. */
let _tenantId = ''
export function setOrganizationId(id: string): void {
  _tenantId = id
}

export async function getByPath(scope: DriveScope, path: string): Promise<DriveFile | null> {
  const { driveFiles } = await import('@modules/drive/schema')
  const { eq, and } = await import('drizzle-orm')
  const db = requireDb() as { select: Function }
  const { scopeName, scopeIdVal } = scopeId(scope, _tenantId)

  const rows = await db
    .select()
    .from(driveFiles)
    .where(
      and(
        eq(driveFiles.organizationId, _tenantId),
        eq(driveFiles.scope, scopeName),
        eq(driveFiles.scopeId, scopeIdVal),
        eq(driveFiles.path, path),
      ),
    )
    .limit(1)
  return (rows[0] as DriveFile) ?? null
}

export async function listFolder(scope: DriveScope, parentId: string | null): Promise<DriveFile[]> {
  const { driveFiles } = await import('@modules/drive/schema')
  const { eq, and, isNull } = await import('drizzle-orm')
  const db = requireDb() as { select: Function }
  const { scopeName, scopeIdVal } = scopeId(scope, _tenantId)

  const rows = await db
    .select()
    .from(driveFiles)
    .where(
      and(
        eq(driveFiles.organizationId, _tenantId),
        eq(driveFiles.scope, scopeName),
        eq(driveFiles.scopeId, scopeIdVal),
        parentId ? eq(driveFiles.parentFolderId, parentId) : isNull(driveFiles.parentFolderId),
      ),
    )
  return rows as DriveFile[]
}

export async function readContent(id: string): Promise<{ content: string; spilledToPath?: string }> {
  const { driveFiles } = await import('@modules/drive/schema')
  const { eq } = await import('drizzle-orm')
  const db = requireDb() as { select: Function }

  const rows = await db.select().from(driveFiles).where(eq(driveFiles.id, id)).limit(1)
  const row = rows[0] as DriveFile | undefined
  if (!row) throw new Error(`drive file not found: ${id}`)

  const content = row.extractedText ?? ''
  return { content }
}

/**
 * Reads /BUSINESS.md from the organization scope.
 * Returns the stub fallback string if the row doesn't exist.
 */
export async function getBusinessMd(): Promise<string> {
  const file = await getByPath({ scope: 'organization' }, '/BUSINESS.md')
  if (!file) return BUSINESS_MD_FALLBACK
  const { content } = await readContent(file.id)
  return content || BUSINESS_MD_FALLBACK
}

// Scaffold — Phase 2
export async function get(_id: string): Promise<DriveFile | null> {
  throw new Error('not-implemented-in-phase-1: drive/files.get')
}

export async function grep(_scope: DriveScope, _pattern: string, _opts?: GrepOpts): Promise<GrepMatch[]> {
  throw new Error('not-implemented-in-phase-1: drive/files.grep')
}

export async function create(_scope: DriveScope, _input: CreateFileInput): Promise<DriveFile> {
  throw new Error('not-implemented-in-phase-1: drive/files.create')
}

export async function mkdir(_scope: DriveScope, _path: string): Promise<DriveFile> {
  throw new Error('not-implemented-in-phase-1: drive/files.mkdir')
}

export async function move(_id: string, _newPath: string): Promise<DriveFile> {
  throw new Error('not-implemented-in-phase-1: drive/files.move')
}

export async function remove(_id: string): Promise<void> {
  throw new Error('not-implemented-in-phase-1: drive/files.remove')
}

export async function ingestUpload(_input: IngestUploadInput): Promise<DriveFile> {
  throw new Error('not-implemented-in-phase-1: drive/files.ingestUpload')
}

export async function saveInboundMessageAttachment(_msgId: string, _targetPath?: string): Promise<DriveFile> {
  throw new Error('not-implemented-in-phase-1: drive/files.saveInboundMessageAttachment')
}

export async function deleteScope(_scope: 'contact', _scopeId: string): Promise<void> {
  throw new Error('not-implemented-in-phase-1: drive/files.deleteScope')
}
