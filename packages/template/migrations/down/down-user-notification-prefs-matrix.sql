-- Down-migration for `20260518000001_user_notification_prefs_matrix`.
--
-- Reverses the matrix migration by re-creating the five flat boolean columns
-- and reverse-deriving them from the jsonb `prefs` map. **Lossy** — the
-- `admin_alert` row of the matrix has no home in the old schema and its
-- in_app/whatsapp/email cells are dropped silently. The flat WA + email
-- toggles after the down-migration represent the OR of the per-kind
-- whatsapp/email cells (the most permissive interpretation, so users keep
-- receiving notifications they previously enabled).
--
-- Run manually against the live DB if a rollback is needed. The script is
-- safe to re-run (uses ADD COLUMN IF NOT EXISTS via guard).

BEGIN;

ALTER TABLE "settings"."user_notification_prefs"
  ADD COLUMN IF NOT EXISTS "mentions_enabled"  boolean DEFAULT true NOT NULL,
  ADD COLUMN IF NOT EXISTS "whatsapp_enabled"  boolean DEFAULT false NOT NULL,
  ADD COLUMN IF NOT EXISTS "email_enabled"     boolean DEFAULT false NOT NULL,
  ADD COLUMN IF NOT EXISTS "approvals_enabled" boolean DEFAULT true NOT NULL,
  ADD COLUMN IF NOT EXISTS "proposals_enabled" boolean DEFAULT true NOT NULL;

UPDATE "settings"."user_notification_prefs" SET
  "mentions_enabled"  = COALESCE(("prefs"->'mention'->>'in_app')::boolean, true),
  "approvals_enabled" = COALESCE(("prefs"->'approval'->>'in_app')::boolean, true),
  "proposals_enabled" = COALESCE(("prefs"->'proposal'->>'in_app')::boolean, true),
  -- Flat WA/email toggles take the OR of the per-kind cells (permissive).
  "whatsapp_enabled" = (
    COALESCE(("prefs"->'mention'->>'whatsapp')::boolean,  false) OR
    COALESCE(("prefs"->'approval'->>'whatsapp')::boolean, false) OR
    COALESCE(("prefs"->'proposal'->>'whatsapp')::boolean, false) OR
    COALESCE(("prefs"->'admin_alert'->>'whatsapp')::boolean, false)
  ),
  "email_enabled" = (
    COALESCE(("prefs"->'mention'->>'email')::boolean,  false) OR
    COALESCE(("prefs"->'approval'->>'email')::boolean, false) OR
    COALESCE(("prefs"->'proposal'->>'email')::boolean, false) OR
    COALESCE(("prefs"->'admin_alert'->>'email')::boolean, false)
  );

ALTER TABLE "settings"."user_notification_prefs" DROP COLUMN IF EXISTS "prefs";

COMMIT;
