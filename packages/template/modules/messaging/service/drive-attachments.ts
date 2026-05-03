/**
 * Drive-attachment lookup for the `messages.md` materializer.
 *
 * The materializer renders per-message attachment blocks pointing at
 * `drive_files` rows. To avoid N+1 query patterns, it pre-fetches a
 * tenant-isolated map of (driveFileId → row projection) ONCE per wake;
 * both the initial workspace materialization and the per-turn
 * `conversationSideLoad` re-render read from the same closure-captured
 * snapshot. This file owns that batched query and the per-wake cache.
 *
 * Tenant isolation (Principle 9): every query carries `organization_id`.
 *
 * Frozen-snapshot discipline (Principle "frozen snapshot"): mid-wake
 * `request_caption` writes do NOT mutate the snapshot — they surface in
 * the NEXT wake's `buildMessagingMaterializers` call.
 */

import { driveFiles } from '@modules/drive/schema'
import { and, eq, inArray } from 'drizzle-orm'

import type { Tx } from '~/runtime'

type DbHandle = {
  select: () => {
    from: (t: unknown) => {
      where: (c: unknown) => Promise<unknown[]>
    }
  }
}

let _currentDb: DbHandle | null = null

/** Install the database handle the lookup reads from. Called from `module.ts`. */
export function setDriveAttachmentsDb(db: unknown): void {
  _currentDb = db as DbHandle
}

export function __resetDriveAttachmentsDbForTests(): void {
  _currentDb = null
}

export interface DriveFileProjection {
  id: string
  path: string
  caption: string | null
  mimeType: string | null
  sizeBytes: number | null
  extractionKind: 'pending' | 'extracted' | 'binary-stub' | 'failed'
}

/**
 * Single batched query, tenant-isolated. Returns a map keyed by drive
 * file id; missing ids simply don't appear in the map (the materializer
 * falls back to the denormalized `attachments[]` jsonb path on misses).
 */
export async function getDriveFilesByIds(
  organizationId: string,
  ids: readonly string[],
  txOverride?: Tx,
): Promise<Map<string, DriveFileProjection>> {
  if (ids.length === 0) return new Map()
  const db = (txOverride ?? _currentDb) as DbHandle | null
  if (!db) {
    throw new Error('messaging/drive-attachments: db not installed — call setDriveAttachmentsDb()')
  }
  const rows = (await db
    .select()
    .from(driveFiles)
    .where(and(eq(driveFiles.organizationId, organizationId), inArray(driveFiles.id, [...ids])))) as Array<{
    id: string
    path: string
    caption: string | null
    mimeType: string | null
    sizeBytes: number | null
    extractionKind: 'pending' | 'extracted' | 'binary-stub' | 'failed'
  }>
  const map = new Map<string, DriveFileProjection>()
  for (const r of rows) {
    map.set(r.id, {
      id: r.id,
      path: r.path,
      caption: r.caption,
      mimeType: r.mimeType,
      sizeBytes: r.sizeBytes,
      extractionKind: r.extractionKind,
    })
  }
  return map
}
