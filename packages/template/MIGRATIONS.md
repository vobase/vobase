# Migrations

The template ships with `drizzle-kit` for schema management. `drizzle/` is `.gitignored` — migrations are regenerated locally per developer from `schema.ts` (the source of truth). `bun run db:reset` does `nuke → push → seed` and re-derives the migration tree.

For most schema work this is fine: change `schema.ts`, run `bun run db:reset` in dev, ship the `schema.ts` change. Downstream forks regenerate cleanly.

## When you need a hand-edited migration

A handful of operations can't be inferred from a Drizzle diff:

- **Cross-pgSchema renames.** `drizzle-kit` sees `schedules.agent_schedules` → `automations.automation_rules` as a DROP + CREATE (data loss) instead of a `SET SCHEMA + RENAME` (data preserved).
- **Backfill INSERTs from one new table into another.** Drizzle generates DDL, not DML — anything that needs `INSERT INTO new SELECT … FROM old` must be hand-written.
- **Renaming a CHECK constraint or index without renaming the underlying table.** Drizzle frequently drops + recreates.

For these, the procedure is:

1. Run `bun run db:generate` to get the default diff.
2. Open the generated `drizzle/<timestamp>_<name>/migration.sql`.
3. Replace the DROP+CREATE block with the correct DDL by hand. Leave a comment at the top citing the plan / story / line that justifies the deviation.
4. Re-run `bun run db:reset` and verify the seed succeeds.
5. **Bake the equivalent runtime-reproducible logic into `modules/<name>/seed.ts`** if the rebuild from a fresh clone needs to land the same end state — because `drizzle/` is `.gitignored`, the hand-edited SQL only lives on your machine. The seed function ships in git and runs on every `db:reset`.

## Slice A.1 case study — `schedules` → `automations` cross-schema rename

The plan at `.omc/plans/automations-and-notifications.md` §6 (Slice A.1) renames `schedules.agent_schedules` to `automations.automation_rules` and adds three sibling tables (`automations`, `automation_runs`, `tenant_budget_caps`).

The hand-edited migration generated locally (`drizzle/20260517054729_rename-agent-schedules-to-automation-rules/migration.sql`) does:

```sql
CREATE SCHEMA "automations";
ALTER TABLE "schedules"."agent_schedules" SET SCHEMA "automations";
ALTER TABLE "automations"."agent_schedules" RENAME TO "automation_rules";
ALTER TABLE "automations"."automation_rules"
  RENAME CONSTRAINT "agent_schedules_cron_check" TO "automation_rules_cron_check";
ALTER INDEX "automations"."uq_agent_schedules_slug"     RENAME TO "uq_automation_rules_slug";
ALTER INDEX "automations"."idx_agent_schedules_enabled" RENAME TO "idx_automation_rules_enabled";

CREATE TABLE "automations"."automations"        (…);
CREATE TABLE "automations"."automation_runs"    (…);
CREATE TABLE "automations"."tenant_budget_caps" (…);

DROP SCHEMA "schedules";
```

Equivalent reproducible logic lives in `modules/automations/seed.ts::seedAutomations(db)` — an idempotent `INSERT INTO automations SELECT … FROM automation_rules ON CONFLICT DO NOTHING` that ships in git and re-runs on every `db:reset`.

## Deploying past Slice A.1 against an existing tenant DB

For tenants that already have rows in `schedules.agent_schedules`:

1. Take a `pg_dump` snapshot before deploy.
2. Apply the cross-schema rename DDL above against the live DB (script the same statements; do not rely on `drizzle-kit` to infer it).
3. Run `seedAutomations(db)` (or the equivalent SQL inline) to populate `automations` rows from the freshly renamed `automation_rules`.
4. Verify with `SELECT COUNT(*) FROM automations.automations` matches `SELECT COUNT(*) FROM automations.automation_rules`.

The template itself is scaffolding (not production-deployed), so this procedure is documented here for downstream forks rather than automated in core.

## Slice B.2 case study — `pending_mention_pings` → `pending_staff_pings` same-schema rename + ADD COLUMN

The plan at `.omc/plans/automations-and-notifications.md` §4 Scenario 6 (US-007) renames `team.pending_mention_pings` to `team.pending_staff_pings` and adds four new columns (`kind`, `reference_id`, `claimed_at`, `claimed_wamid`) to generalize the ledger to multi-kind pings and switch claims from DELETE…RETURNING to soft-delete.

The hand-edited migration (`drizzle/20260517074429_migration_1779003866391/migration.sql`) does:

```sql
ALTER TABLE "team"."pending_mention_pings" RENAME TO "pending_staff_pings";
ALTER TABLE "team"."pending_staff_pings" ADD COLUMN "kind" text NOT NULL DEFAULT 'mention';
ALTER TABLE "team"."pending_staff_pings" ADD COLUMN "reference_id" text;
ALTER TABLE "team"."pending_staff_pings" ADD COLUMN "claimed_at" timestamp with time zone;
ALTER TABLE "team"."pending_staff_pings" ADD COLUMN "claimed_wamid" text;

ALTER INDEX "team"."idx_pending_pings_staff"      RENAME TO "idx_pending_staff_pings_staff";
ALTER INDEX "team"."idx_pending_pings_created"    RENAME TO "idx_pending_staff_pings_created";
ALTER INDEX "team"."uq_pending_pings_conv_staff"  RENAME TO "uq_pending_staff_pings_conv_staff";

CREATE INDEX "idx_pending_staff_pings_live"
  ON "team"."pending_staff_pings" ("staff_user_id","organization_id")
  WHERE "claimed_at" IS NULL;
```

Drizzle-kit inferred this as DROP+CREATE (data loss). We replaced it with ALTER TABLE RENAME + ADD COLUMN so live rows survive the deploy.

A **paired down-migration** lives at `migrations/down/down-rename-staff-pings-to-mention-pings.sql`. It includes a safety gate that aborts if any row has `kind != 'mention'` (those rows have no home in the old schema) before reversing all the DDL. Run it manually against the live DB if a rollback is needed.

## Deploying past Slice B.2 against an existing tenant DB

For tenants that already have rows in `team.pending_mention_pings`:

1. Take a `pg_dump` snapshot before deploy.
2. Apply the forward migration DDL above against the live DB.
3. Verify: `SELECT kind, COUNT(*) FROM team.pending_staff_pings GROUP BY kind` — all rows should have `kind = 'mention'`.
4. To roll back: run `migrations/down/down-rename-staff-pings-to-mention-pings.sql` (safety gate will abort if non-mention rows exist).

The `kind DEFAULT 'mention'` ensures all pre-existing rows are automatically classified as mention pings with no DML backfill needed.

## Slice B.3 case study — `user_notification_prefs` flat booleans → jsonb matrix

The plan at `.omc/plans/automations-and-notifications.md` §8 (US-024+ notifications matrix) replaces the five flat boolean columns on `settings.user_notification_prefs` (`mentions_enabled`, `whatsapp_enabled`, `email_enabled`, `approvals_enabled`, `proposals_enabled`) with a single jsonb `prefs` column that holds the full `NotificationKind × NotificationChannel` matrix (4 kinds × 3 channels). The previous flat shape couldn't express "email me for approvals but WhatsApp only for mentions", and admin alerts had no toggle at all.

The hand-edited migration (`drizzle/20260518000001_user_notification_prefs_matrix/migration.sql`) does:

```sql
ALTER TABLE "settings"."user_notification_prefs"
  ADD COLUMN "prefs" jsonb DEFAULT '{}'::jsonb NOT NULL;

UPDATE "settings"."user_notification_prefs" SET "prefs" = jsonb_build_object(
  'mention',     jsonb_build_object('in_app', mentions_enabled,  'whatsapp', mentions_enabled  AND whatsapp_enabled, 'email', mentions_enabled  AND email_enabled),
  'approval',    jsonb_build_object('in_app', approvals_enabled, 'whatsapp', approvals_enabled AND whatsapp_enabled, 'email', approvals_enabled AND email_enabled),
  'proposal',    jsonb_build_object('in_app', proposals_enabled, 'whatsapp', proposals_enabled AND whatsapp_enabled, 'email', proposals_enabled AND email_enabled),
  'admin_alert', jsonb_build_object('in_app', true,              'whatsapp', whatsapp_enabled,                       'email', email_enabled)
);

ALTER TABLE "settings"."user_notification_prefs" DROP COLUMN "mentions_enabled";
ALTER TABLE "settings"."user_notification_prefs" DROP COLUMN "whatsapp_enabled";
ALTER TABLE "settings"."user_notification_prefs" DROP COLUMN "email_enabled";
ALTER TABLE "settings"."user_notification_prefs" DROP COLUMN "approvals_enabled";
ALTER TABLE "settings"."user_notification_prefs" DROP COLUMN "proposals_enabled";
```

Drizzle-kit would have inferred the column shape change as DROP+CREATE (data loss). We hand-wrote ADD COLUMN + UPDATE backfill + DROP so live rows survive the deploy. `admin_alert` is new — pre-migration rows had no per-kind admin gate, so we synthesise it from the flat `whatsapp_enabled` + `email_enabled` toggles plus `in_app = true`.

A **paired down-migration** lives at `migrations/down/down-user-notification-prefs-matrix.sql`. It is **lossy** by design: the down-migration recreates the five flat booleans and OR-merges the per-kind WA/email cells (the most permissive reading, so users keep receiving anything they previously enabled), but it can't recover any per-kind cell differences (e.g. "email for approvals, no email for mentions" collapses to a single `email_enabled = true`). The `admin_alert` row of the matrix is dropped silently on downgrade — that's the documented data loss.

## Deploying past Slice B.3 against an existing tenant DB

For tenants that already have rows in `settings.user_notification_prefs`:

1. Take a `pg_dump` snapshot before deploy.
2. Apply the forward migration DDL above against the live DB.
3. Verify: `SELECT prefs FROM settings.user_notification_prefs LIMIT 5` — every row should carry the four-kind matrix populated from the legacy flat booleans.
4. To roll back: run `migrations/down/down-user-notification-prefs-matrix.sql` (lossy — per-kind channel differences and `admin_alert` cells are discarded).

Reads merge the stored matrix with verification-aware defaults at the service layer (`modules/settings/service/notification-prefs.ts::fillMatrix`), so cells missing from storage never break dispatch — `in_app` defaults to true, `whatsapp` defaults to `auth.user.phoneNumberVerified === true` at read time (flips with verification without a write), `email` defaults to false.
