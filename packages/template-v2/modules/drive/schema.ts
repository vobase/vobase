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
export type DriveScopeName = 'organization' | 'contact' | 'staff'
export type DriveSource = 'customer_inbound' | 'agent_uploaded' | 'staff_uploaded' | 'admin_uploaded' | null
export type DriveProcessingStatus = 'pending' | 'processing' | 'ready' | 'failed'

export interface DriveFile {
  id: string
  organizationId: string
  scope: DriveScopeName
  scopeId: string
  parentFolderId: string | null
  kind: DriveKind
  name: string
  path: string
  mimeType: string | null
  sizeBytes: number | null
  storageKey: string | null
  caption: string | null
  captionModel: string | null
  captionUpdatedAt: Date | null
  extractedText: string | null
  source: DriveSource
  sourceMessageId: string | null
  tags: string[]
  uploadedBy: string | null
  processingStatus: DriveProcessingStatus
  processingError: string | null
  threatScanReport: unknown
  createdAt: Date
  updatedAt: Date
}

// ─── Tables ─────────────────────────────────────────────────────────────────

import { drivePgSchema } from '@server/db/pg-schemas'
import { nanoidPrimaryKey } from '@vobase/core/schema'
import { sql } from 'drizzle-orm'
import { check, index, integer, jsonb, text, timestamp, uniqueIndex } from 'drizzle-orm/pg-core'

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
    /** Scope-relative path (e.g. '/services/pricing-2026.pdf'). */
    path: text('path').notNull(),
    mimeType: text('mime_type'),
    sizeBytes: integer('size_bytes'),
    storageKey: text('storage_key'),
    caption: text('caption'),
    captionModel: text('caption_model'),
    captionUpdatedAt: timestamp('caption_updated_at', { withTimezone: true }),
    extractedText: text('extracted_text'),
    source: text('source'),
    /** Cross-schema FK to inbox.messages(id); enforced post-push. */
    sourceMessageId: text('source_message_id'),
    tags: text('tags').array().notNull().default([]),
    uploadedBy: text('uploaded_by'),
    processingStatus: text('processing_status').default('ready'),
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
    check('drive_scope_check', sql`scope IN ('organization','contact','staff')`),
    check(
      'drive_source_check',
      sql`source IS NULL OR source IN ('customer_inbound','agent_uploaded','staff_uploaded','admin_uploaded')`,
    ),
  ],
)
