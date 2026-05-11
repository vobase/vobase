---
'@vobase/core': minor
'@vobase/template': minor
'@vobase/cli': minor
'create-vobase': minor
---

# Staff WhatsApp number entry + display in the team UI

Wires up the missing UI for Slice 3's notification-tier reconciler: the backend already accepted `staff_profiles.whatsapp_phone_e164` since US-021 and the reconciler synced it to platform staff-links, but the team UI had no way to enter or view the number.

## Tenant template (`@vobase/template`)

- **`team/components/staff-form-dialog.tsx`** — new "WhatsApp number" input below Languages. Validates E.164 with leading `+` (`^\+[1-9]\d{6,14}$`) inline; empty clears the column.
- **`team/pages/$userId.tsx`** — new "WhatsApp" row in the Profile InfoCard (monospace number or `—`); patches `whatsappPhoneE164` through to the existing `PATCH /api/team/staff/:userId` handler so the reconciler enqueue fires.
- **`team/pages/index.tsx`** — new sortable + text-filterable "WhatsApp" column in the staff list, between Languages and Capacity.
- **`team/hooks/use-staff.ts`** — `UpsertStaffBody` type extended with optional `whatsappPhoneE164` so the typed RPC client accepts the field.

No backend changes — the handler, schema column, and reconciler already shipped in Slice 3.

## Other packages

- `@vobase/core`, `@vobase/cli`, `create-vobase` — no functional changes; linked-packages config bumps them in lockstep with `@vobase/template`.
