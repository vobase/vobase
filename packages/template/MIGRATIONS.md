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
