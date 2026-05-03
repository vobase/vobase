/**
 * Drive service types — scope discriminants and input shapes.
 * Consumed by workspace, agents observers, channels, and the dev layer.
 */

import type { DriveExtractionKind, DriveFile, DriveSource } from '../schema'

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

/**
 * Auth-agnostic input to `ingestUpload`. Auth/scope-write checks live in the
 * HTTP handler — `ingestUpload` itself trusts its caller (handler or trusted
 * in-process inbound boundary).
 *
 * `bytes` is the raw file content; the service uploads it to storage. The
 * caller never invents a `storageKey` — the service derives one from
 * `originalName` so the on-disk extension matches the bytes-as-uploaded
 * filename.
 */
export interface IngestUploadInput {
  organizationId: string
  scope: DriveScope
  /** Bytes-as-uploaded filename (`quote.pdf`); audit + UI hover, never mutated. */
  originalName: string
  mimeType: string
  sizeBytes: number
  bytes: Buffer | Uint8Array
  /** Source of the upload — metadata only (audit / UI), not an auth gate. */
  source: NonNullable<DriveSource>
  /** User who initiated the upload (null for `customer_inbound`). */
  uploadedBy: string | null
  /** Folder under which the new row lives — must end with `/`. */
  basePath: string
}

export interface IngestUploadResult {
  id: string
  path: string
  nameStem: string
  extractionKind: DriveExtractionKind
}

export interface RequestCaptionInput {
  fileId: string
  conversationId: string
  contactId: string
  organizationId: string
}

export type RequestCaptionResult =
  | { ok: true; accepted: true; eta_ms: number }
  | { ok: false; error: string; sizeBytes?: number; maxBytes?: number }

export interface SearchDriveInput {
  organizationId: string
  query: string
  scope?: DriveScope
  limit?: number
}

export interface SearchDriveHit {
  fileId: string
  path: string
  caption: string | null
  chunkIndex: number
  excerpt: string
  score: number
}

/**
 * Reference to a drive-backed attachment, denormalized onto a message row.
 * `driveFileId` is the durable handle; `path` is denormed for materializer
 * speed and refreshed when paths drift (Step 13's join handles missing rows).
 */
export interface MessageAttachmentRef {
  driveFileId: string
  path: string
  mimeType: string
  sizeBytes: number
  name: string
  caption: string | null
  extractionKind: DriveExtractionKind
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
