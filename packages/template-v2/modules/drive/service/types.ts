/**
 * Drive service types — scope discriminants and input shapes.
 * Consumed by workspace, agents observers, channels, and the dev layer.
 */

import type { DriveFile } from '../schema'

export type DriveScope =
  | { scope: 'organization' }
  | { scope: 'contact'; contactId: string }
  | { scope: 'staff'; userId: string }
  | { scope: 'agent'; agentId: string }

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

/**
 * Read-only slice of `FilesService` the BUSINESS.md materializer depends on.
 * Defined here (not under `agent.ts`) so the type lives next to its
 * service-layer source-of-truth and `agent.ts` stays purely declarative.
 */
export interface DriveReader {
  getByPath(scope: DriveScope, path: string): Promise<DriveFile | null>
  readContent(id: string): Promise<{ content: string; spilledToPath?: string }>
}
