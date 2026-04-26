/**
 * Audit trail for the declarative-resource reconciler.
 *
 * One row per drift / conflict / tombstone event so operators can see why a
 * runtime row diverged from its on-disk source without spelunking through
 * server logs. Lives in `infra` because it's pure platform plumbing — no
 * domain module owns it.
 */

import { sql } from 'drizzle-orm'
import { check, index, jsonb, text, timestamp } from 'drizzle-orm/pg-core'

import { nanoidPrimaryKey } from '../db/helpers'
import { infraPgSchema } from '../db/pg-schemas'

export type ReconcilerAuditSeverity = 'info' | 'warn' | 'error'
export type ReconcilerAuditKind =
  | 'inserted'
  | 'updated'
  | 'tombstoned'
  | 'drift_detected'
  | 'parse_error'
  | 'reference_dangling'

export const reconcilerAudit = infraPgSchema.table(
  'reconciler_audit',
  {
    id: nanoidPrimaryKey(),
    /** Resource kind (e.g. `'saved_views'`, `'agent_skills'`). */
    resourceKind: text('resource_kind').notNull(),
    /** Audit-event kind. See `ReconcilerAuditKind`. */
    kind: text('kind').notNull(),
    severity: text('severity').notNull().default('info'),
    slug: text('slug'),
    scope: text('scope'),
    detail: jsonb('detail').$type<Record<string, unknown>>().notNull().default({}),
    recordedAt: timestamp('recorded_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    index('idx_recon_audit_kind').on(t.resourceKind, t.kind),
    index('idx_recon_audit_recorded_at').on(t.recordedAt),
    check('reconciler_audit_severity_check', sql`severity IN ('info','warn','error')`),
    check(
      'reconciler_audit_kind_check',
      sql`kind IN ('inserted','updated','tombstoned','drift_detected','parse_error','reference_dangling')`,
    ),
  ],
)
