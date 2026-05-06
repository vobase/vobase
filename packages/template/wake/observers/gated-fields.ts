/**
 * Per-resource gated-field sets — the workspace-sync observer turns these
 * into queued (vs auto-applied) `field_set` proposals; the sensitive-write
 * warner uses the same sets to surface a same-turn stderr notice the moment
 * the agent edits one of them.
 *
 * Mirrors the `requiresApprovalForFields` arg passed to
 * `registerChangeMaterializer` in `modules/contacts/module.ts` and
 * `modules/team/module.ts`. If those drift, the inbox copy will under-warn
 * about queued fields but the registry still gates correctly — fail-soft.
 */

export const CONTACT_GATED_FIELDS: ReadonlySet<string> = new Set(['displayName', 'email'])
export const STAFF_GATED_FIELDS: ReadonlySet<string> = new Set(['displayName', 'email'])
