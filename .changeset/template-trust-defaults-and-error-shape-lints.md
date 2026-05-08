---
"@vobase/template": patch
"create-vobase": patch
---

Add two CI lint rules at CLI verb boundaries.

`check:trust-defaults` (`scripts/check-trust-defaults.ts`) — scans every file under `modules/` for trust-bearing input fields (`confidence`, `severity`, `priority`, `sensitivity`, `autoApply` / `auto_apply`) declared with literal `.default(...)` values in their Zod schema. Trust levels must be derived in the verb body from `ctx.principal` (see the `effectiveConfidence` pattern in `modules/contacts/cli.ts`), not baked into the schema. Closes the bug class behind the phone-hallucination from 2026-05 — a verb's `confidence: z.number().default(1.0)` quietly set `1.0` for every agent-origin call, exceeding the auto-bar for high-sensitivity fields and auto-writing fabricated values.

`check:error-shape` (`scripts/check-error-shape.ts`) — scans `cli.ts` and `verbs/**/*.ts` for `error:` properties whose values include `cause.detail`, `cause.message`, `pg.detail`, or `pg.message`, and `data:` properties that pass the bare `cause` / `pg` identifier (or spread it). Closes the bug class behind the cross-account leak from 2026-05 where a verb forwarded raw 23505 `cause.detail` (which contains the conflicting row's primary-key tuple, including `organization_id`) into the agent-visible `error:` string — disclosing existence of another tenant's contact.

Both rules wire into the existing `check:*` aggregator (`bun run check`); CI picks them up via the `conc bun:check:*` glob.
