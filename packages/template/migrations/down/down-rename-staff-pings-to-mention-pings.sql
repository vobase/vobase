-- Down: reverse the Slice B.2 rename (US-007).
-- Paired with: drizzle/20260517074429_migration_1779003866391/migration.sql
--
-- SAFETY GATE: aborts if any row has kind != 'mention', because those rows
-- would have no home in the old pending_mention_pings schema (which had no
-- kind column). Rolling back with approval/proposal rows present is unsafe.
DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM team.pending_staff_pings WHERE kind <> 'mention') THEN
    RAISE EXCEPTION 'down migration aborted: pending_staff_pings has non-mention rows (kind != mention) which would be dropped on rollback';
  END IF;
END $$;

DROP INDEX IF EXISTS "team"."idx_pending_staff_pings_live";
ALTER INDEX "team"."uq_pending_staff_pings_conv_staff" RENAME TO "uq_pending_pings_conv_staff";
ALTER INDEX "team"."idx_pending_staff_pings_created" RENAME TO "idx_pending_pings_created";
ALTER INDEX "team"."idx_pending_staff_pings_staff" RENAME TO "idx_pending_pings_staff";
ALTER TABLE "team"."pending_staff_pings" DROP COLUMN "claimed_wamid";
ALTER TABLE "team"."pending_staff_pings" DROP COLUMN "claimed_at";
ALTER TABLE "team"."pending_staff_pings" DROP COLUMN "reference_id";
ALTER TABLE "team"."pending_staff_pings" DROP COLUMN "kind";
ALTER TABLE "team"."pending_staff_pings" RENAME TO "pending_mention_pings";
