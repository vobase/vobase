/**
 * DrivePort — unified file tree across tenant-scope (KB) and contact-scope.
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
