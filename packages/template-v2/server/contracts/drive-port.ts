/**
 * DrivePort — spec §6.4. Unified file tree across tenant-scope (KB) and contact-scope.
 *
 * Phase 1 REAL methods (per plan §R4):
 *   - `getByPath(scope, path)`
 *   - `listFolder(scope, parentId)`
 *   - `readContent(id)`
 *   + BUSINESS.md lookup with built-in stub fallback (spec §5.4 + §7.4)
 * All other methods throw `not-implemented-in-phase-1` until Phase 2.
 */

import type { DriveFile } from './domain-types'

export type DriveScope = { scope: 'tenant' } | { scope: 'contact'; contactId: string }

export interface CreateFileInput {
  parentFolderId?: string | null
  kind: 'folder' | 'file'
  name: string
  path: string
  mimeType?: string
  sizeBytes?: number
  storageKey?: string
  extractedText?: string
  caption?: string
  source?: DriveFile['source']
  sourceMessageId?: string
  tags?: string[]
  uploadedBy?: string
}

export interface GrepOpts {
  limit?: number
  caseInsensitive?: boolean
}

export interface GrepMatch {
  fileId: string
  path: string
  line: number
  excerpt: string
}

export interface IngestUploadInput {
  scope: DriveScope
  path: string
  mimeType: string
  sizeBytes: number
  storageKey: string
  uploadedBy: string
  source?: DriveFile['source']
  parentFolderId?: string | null
}

export interface DrivePort {
  // read
  get(id: string): Promise<DriveFile | null>
  getByPath(scope: DriveScope, path: string): Promise<DriveFile | null>
  listFolder(scope: DriveScope, parentId: string | null): Promise<DriveFile[]>
  readContent(id: string): Promise<{ content: string; spilledToPath?: string }>
  grep(scope: DriveScope, pattern: string, opts?: GrepOpts): Promise<GrepMatch[]>

  // write
  create(scope: DriveScope, input: CreateFileInput): Promise<DriveFile>
  mkdir(scope: DriveScope, path: string): Promise<DriveFile>
  move(id: string, newPath: string): Promise<DriveFile>
  delete(id: string): Promise<void>

  // ingest
  ingestUpload(input: IngestUploadInput): Promise<DriveFile>
  saveInboundMessageAttachment(msgId: string, targetPath?: string): Promise<DriveFile>

  // scope-level cascade
  deleteScope(scope: 'contact', scopeId: string): Promise<void>
}
