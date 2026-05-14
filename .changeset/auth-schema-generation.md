---
'@vobase/core': minor
'@vobase/template': patch
---

refactor(auth): generate the auth schema via the better-auth CLI; adopt the official apiKey plugin

Fixes the bug where new tenant projects got the better-auth tables duplicated
into both the `auth` and `public` Postgres schemas.

## core (breaking surface reduction)

Core ships infrastructure primitives, not app schema. The hand-written
better-auth drizzle schema, the `authPgSchema` export, the auth table exports
(`authUser`, `authSession`, …), and the unused `VerifyApiKey` / `CreateApiKey`
/ `RevokeApiKey` contract types are all removed from the public surface. The
`better-auth` / `@better-auth/api-key` peer deps are dropped — core has zero
runtime use of better-auth. App code now owns its auth schema in the template.

## template

- **CLI-generated auth schema.** `bun run gen:auth` runs the pinned `auth` CLI
  against `auth/auth.config.ts`, then rewrites the flat output into the vobase
  shape: `auth` pg schema, timezone-aware timestamps, `defaultNow()` on
  created/updated columns. Output splits into `schema-tables.ts` (native names,
  drizzle-kit reads this) and `schema.ts` (re-export + `auth`-prefixed aliases,
  app code reads this) so each table registers exactly once. `auth/plugins.ts`
  is the single source of truth for the schema-contributing plugin set, shared
  by the runtime and CLI-introspection configs so they can't drift.
  `check:auth-schema` guards this in CI.
- **Official `apiKey` plugin.** The custom API-key service is replaced by
  `@better-auth/api-key`. A valid `Authorization: Bearer vbt_<key>` mocks a
  session, so the CLI catalog/dispatch routes and `/api/auth/whoami` resolve
  through the standard session → org → role middleware chain — one auth path
  for cookie and bearer callers alike.
