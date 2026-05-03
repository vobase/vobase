/**
 * drive module schema.
 *
 * One unified table: `drive.files`. Folders and files co-exist; `scope + scope_id`
 * partitions the tree into organization-wide KB vs per-contact drive. Same caption/
 * extract/threat-scan pipeline for both scopes.
 *
 * `/BUSINESS.md` lives as a regular row (`scope='organization', path='/BUSINESS.md'`);
 * the harness materializer pre-loads it into the frozen system prompt.
 *
 * pg_trgm + GIN index on (extracted_text || ' ' || caption) accelerates `grep`.
 */

// ─── Domain types ───────────────────────────────────────────────────────────

export type DriveKind = 'folder' | 'file'
export type DriveScopeName = 'organization' | 'contact' | 'staff' | 'agent'
export type DriveSource = 'customer_inbound' | 'agent_uploaded' | 'staff_uploaded' | 'admin_uploaded' | null
export type DriveProcessingStatus = 'pending' | 'processing' | 'ready' | 'failed'
export type DriveExtractionKind = 'pending' | 'extracted' | 'binary-stub' | 'failed'

export interface DriveFile {
  id: string
  organizationId: string
  scope: DriveScopeName
  scopeId: string
  parentFolderId: string | null
  kind: DriveKind
  name: string
  /** Display path. Extractable mimes → `<nameStem>.md`; binary → `<nameStem>.<originalExt>`. */
  path: string
  mimeType: string | null
  sizeBytes: number | null
  storageKey: string | null
  caption: string | null
  captionModel: string | null
  captionUpdatedAt: Date | null
  extractedText: string | null
  /** Bytes-as-uploaded filename (audit + UI hover, never mutated). */
  originalName: string | null
  /** Basename without ext; stable across re-extraction. */
  nameStem: string | null
  source: DriveSource
  sourceMessageId: string | null
  tags: string[]
  uploadedBy: string | null
  processingStatus: DriveProcessingStatus
  /** Extraction lifecycle discriminator — separate from processing_status to keep audit cheap. */
  extractionKind: DriveExtractionKind
  processingError: string | null
  threatScanReport: unknown
  createdAt: Date
  updatedAt: Date
}

export interface DriveChunk {
  id: string
  organizationId: string
  scope: DriveScopeName
  scopeId: string
  fileId: string
  chunkIndex: number
  content: string
  /** 1536-d float vector encoded as `[a,b,c,...]` text. */
  embedding: string | null
  tokenCount: number
  createdAt: Date
}

// ─── Tables ─────────────────────────────────────────────────────────────────

import { nanoidPrimaryKey } from '@vobase/core/schema'
import { sql } from 'drizzle-orm'
import { check, customType, index, integer, jsonb, text, timestamp, uniqueIndex } from 'drizzle-orm/pg-core'

import { drivePgSchema } from '~/runtime'

/**
 * pgvector column type. Stored as `vector(1536)` in Postgres; serialized as
 * `[a,b,c,...]` text by drizzle (we coerce in/out at the service layer).
 */
const vector = customType<{ data: string; driverData: string }>({
  dataType() {
    return 'vector(1536)'
  },
})

/**
 * Generated tsvector column. Computed from `content` so search hits stay
 * consistent with the body without trigger maintenance.
 */
const tsvector = customType<{ data: string; driverData: string }>({
  dataType() {
    return "tsvector GENERATED ALWAYS AS (to_tsvector('english', content)) STORED"
  },
})

export const driveFiles = drivePgSchema.table(
  'files',
  {
    id: nanoidPrimaryKey(),
    organizationId: text('organization_id').notNull(),
    scope: text('scope').notNull(),
    scopeId: text('scope_id').notNull(),
    /** Self-ref: parent folder in the same tree. */
    parentFolderId: text('parent_folder_id'),
    kind: text('kind').notNull(),
    name: text('name').notNull(),
    /** Display path (e.g. '/services/pricing-2026.md'). */
    path: text('path').notNull(),
    mimeType: text('mime_type'),
    sizeBytes: integer('size_bytes'),
    storageKey: text('storage_key'),
    caption: text('caption'),
    captionModel: text('caption_model'),
    captionUpdatedAt: timestamp('caption_updated_at', { withTimezone: true }),
    extractedText: text('extracted_text'),
    /** Bytes-as-uploaded filename. Audit + UI hover; never mutated post-insert. */
    originalName: text('original_name'),
    /** Basename without ext; stable across re-extraction (lets `path` recompute deterministically). */
    nameStem: text('name_stem'),
    source: text('source'),
    /** Cross-schema FK to messaging.messages(id); enforced post-push. */
    sourceMessageId: text('source_message_id'),
    tags: text('tags').array().notNull().default([]),
    uploadedBy: text('uploaded_by'),
    processingStatus: text('processing_status').default('ready'),
    /** Extraction lifecycle: pending → extracted | binary-stub | failed. */
    extractionKind: text('extraction_kind').notNull().default('pending'),
    processingError: text('processing_error'),
    threatScanReport: jsonb('threat_scan_report'),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp('updated_at', { withTimezone: true })
      .notNull()
      .defaultNow()
      .$onUpdate(() => new Date()),
  },
  (t) => [
    index('idx_drive_scope_path').on(t.organizationId, t.scope, t.scopeId, t.path),
    index('idx_drive_parent').on(t.parentFolderId).where(sql`${t.parentFolderId} IS NOT NULL`),
    uniqueIndex('uq_drive_path').on(t.organizationId, t.scope, t.scopeId, t.path),
    uniqueIndex('uq_drive_parent_name').on(t.organizationId, t.scope, t.scopeId, t.parentFolderId, t.name),
    check('drive_kind_check', sql`kind IN ('folder','file')`),
    check('drive_scope_check', sql`scope IN ('organization','contact','staff','agent')`),
    check(
      'drive_source_check',
      sql`source IS NULL OR source IN ('customer_inbound','agent_uploaded','staff_uploaded','admin_uploaded')`,
    ),
    check('drive_extraction_kind_check', sql`extraction_kind IN ('pending','extracted','binary-stub','failed')`),
  ],
)

export const driveChunks = drivePgSchema.table(
  'chunks',
  {
    id: nanoidPrimaryKey(),
    organizationId: text('organization_id').notNull(),
    scope: text('scope').notNull(),
    scopeId: text('scope_id').notNull(),
    fileId: text('file_id').notNull(),
    chunkIndex: integer('chunk_index').notNull(),
    content: text('content').notNull(),
    /** Stored as `vector(1536)` — see `customType` above. Nullable until the embedding job lands. */
    embedding: vector('embedding'),
    tokenCount: integer('token_count').notNull().default(0),
    /** Generated tsvector for hybrid search. */
    tsv: tsvector('tsv'),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    index('idx_drive_chunks_scope').on(t.organizationId, t.scope, t.scopeId),
    index('idx_drive_chunks_file').on(t.fileId),
    // Raw SQL HNSW + GIN — drizzle-kit's index DSL doesn't yet model `USING hnsw` /
    // `vector_cosine_ops`. The push script runs these after the table create.
    index('idx_drive_chunks_hnsw').using('hnsw', sql`${t.embedding} vector_cosine_ops`),
    index('idx_drive_chunks_tsv').using('gin', t.tsv),
  ],
)
