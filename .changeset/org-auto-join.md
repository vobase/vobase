---
"@vobase/core": minor
---

Add organization auto-join on sign-in and multi-org support

- Configure better-auth organization plugin with `multiOrg` flag (default `false` for single-org soft-lock) and `sendInvitationEmail` callback
- Auto-join organization after sign-in: pending invitation acceptance (any mode) or domain-based join (single-org only)
- Auto-set `activeOrganizationId` on session so `requireOrg()` works immediately
- Export `SendInvitationEmail` type from core
