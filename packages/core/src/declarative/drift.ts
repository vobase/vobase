/**
 * Drift detection between an on-disk file and its corresponding row.
 *
 * Three outcomes:
 *   - `'in_sync'`     : content hash matches; no action.
 *   - `'file_drifted'`: row's `origin === 'file'` but the file content hash
 *                       changed — reconciler should update the row.
 *   - `'row_diverged'`: row's `origin !== 'file'` (user/agent edited at
 *                       runtime) AND the file hash differs from what was
 *                       last seeded; reconciler MUST NOT clobber. Surfaced
 *                       as a `drift_detected` audit row instead.
 */

import { reconcilerAudit } from '../schemas/declarative'
import type { Authored, Origin } from './types'

export type DriftOutcome = 'in_sync' | 'file_drifted' | 'row_diverged'

export interface DriftInput {
  rowOrigin: Origin
  rowFileHash: string | null
  fileHash: string
}

export function classifyDrift(input: DriftInput): DriftOutcome {
  if (input.rowFileHash === input.fileHash) return 'in_sync'
  if (input.rowOrigin === 'file') return 'file_drifted'
  return 'row_diverged'
}

export interface AuditDriftDeps {
  // biome-ignore lint/complexity/noBannedTypes: matches the established cross-module Function-shape pattern
  db: { insert: Function }
}

export interface AuditDriftInput {
  resourceKind: string
  row: Pick<Authored<unknown>, 'slug' | 'scope' | 'origin' | 'fileContentHash'>
  filePath: string
  fileHash: string
}

/**
 * Persist a `drift_detected` audit row. Idempotent best-effort: identical
 * detail JSON within the same minute is collapsed by the unique-detail check,
 * but Postgres-side dedupe is not required for correctness — operators can
 * filter the audit feed downstream.
 */
export async function recordDriftConflict(deps: AuditDriftDeps, input: AuditDriftInput): Promise<void> {
  await deps.db.insert(reconcilerAudit).values({
    resourceKind: input.resourceKind,
    kind: 'drift_detected',
    severity: 'warn',
    slug: input.row.slug,
    scope: input.row.scope,
    detail: {
      filePath: input.filePath,
      fileHash: input.fileHash,
      rowOrigin: input.row.origin,
      rowFileHash: input.row.fileContentHash,
    },
  })
}

export interface RecordSimpleAuditInput {
  resourceKind: string
  kind: 'inserted' | 'updated' | 'tombstoned' | 'parse_error'
  severity?: 'info' | 'warn' | 'error'
  slug: string | null
  scope: string | null
  detail?: Record<string, unknown>
}

export async function recordReconcilerAudit(deps: AuditDriftDeps, input: RecordSimpleAuditInput): Promise<void> {
  await deps.db.insert(reconcilerAudit).values({
    resourceKind: input.resourceKind,
    kind: input.kind,
    severity: input.severity ?? 'info',
    slug: input.slug,
    scope: input.scope,
    detail: input.detail ?? {},
  })
}
