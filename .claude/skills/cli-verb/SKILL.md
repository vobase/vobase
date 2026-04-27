---
name: cli-verb
description: |
  defineCliVerb registration pattern for vobase modules. Use this skill when adding, modifying, or debugging CLI verbs (`vobase contacts list`, `vobase messaging reply`, etc.), wiring custom verb groups into a tenant module, or troubleshooting why a verb is missing from the binary's catalog. Also use when the user says "register a CLI verb", "add a vobase command", "module-side CLI handler", "verb dispatcher", or "make this RPC available on the binary".
---

# defineCliVerb pattern

The vobase CLI is **catalog-driven**: the binary at `packages/cli/bin/vobase.ts` has zero static knowledge of verbs. On every command it asks the tenant's `/api/cli/verbs` endpoint which verbs exist, then dispatches to the verb's HTTP route. Modules contribute verbs by calling `ctx.cli.register(defineCliVerb({...}))` (or `ctx.cli.registerAll([...])`) during their `init` hook.

## When to apply

- Any time you want a module operation to be reachable from the standalone CLI binary OR from the agent's bash sandbox (in-process transport).
- Adding scripted operations to a tenant deployment without modifying the CLI source.

Skip when the operation should be HTTP-only (a customer-facing API endpoint) or only invoked from within the same module's UI.

## Anatomy of a verb

```ts
// modules/<module>/cli.ts
import { defineCliVerb } from '@vobase/core'
import { z } from 'zod'

import * as svc from './service/<thing>'

export const exampleListVerb = defineCliVerb({
  name: 'example list',                  // multi-word ⇒ `vobase example list`
  description: 'List example rows.',
  input: z.object({
    limit: z.number().int().positive().max(500).default(50),
  }),
  body: async ({ input, ctx }) => {
    const rows = await svc.list(ctx.organizationId, { limit: input.limit })
    return { ok: true as const, data: rows }
  },
  formatHint: 'table:cols=id,name,createdAt',
})

export const exampleVerbs = [exampleListVerb /* , exampleShowVerb, … */] as const
```

```ts
// modules/<module>/module.ts
import type { ModuleDef } from '~/runtime'
import { exampleVerbs } from './cli'

const example: ModuleDef = {
  name: 'example',
  jobs: [],
  init(ctx) {
    // … other singleton service installation …
    ctx.cli.registerAll(exampleVerbs)
  },
}
```

## Naming

- Whitespace-separated tokens map to nested CLI groups: `'example list pending'` ↦ `vobase example list pending`. The resolver does longest-prefix matching, so `example list` and `example list pending` can coexist.
- Names must be unique across modules; collisions throw `VobaseCliCollisionError` at boot.

## Roles

`rolesAllowed: ['admin', 'developer']` — empty/undefined ⇒ any authenticated principal. Enforced by the dispatcher before `body` runs.

## Output rendering

`formatHint` drives the CLI's generic renderer:

- `'table:cols=id,name,createdAt'` — column-aligned table for arrays of objects
- `'json'` — pretty-printed JSON
- `'lines:field=path'` — one line per array element, drawn from `path` field
- omitted — generic-object pretty-print + array count summary

`--json` always overrides the hint and emits raw JSON.

## Tenancy

Every verb body has `ctx.organizationId` from the resolved API-key principal. **Always** filter writes/reads by `ctx.organizationId`. For verbs that take an `id` and pass it to a singleton service, double-check the row's `organizationId === ctx.organizationId` before acting:

```ts
const row = await svc.get(input.id)
if (row.organizationId !== ctx.organizationId) {
  return { ok: false as const, error: 'row not in this organization', errorCode: 'forbidden' }
}
```

## Cross-transport parity

The same body runs in-process (the agent's bash sandbox) and over HTTP-RPC (the binary). Consequences:

- Verb bodies must be **pure with respect to the transport** — no `c.req.*`, no `process.stdout.write`, no streaming.
- Return data must be **JSON-serialisable** — no class instances, no functions, no `bigint`.
- Errors flow through the typed `{ ok: false, error, errorCode }` shape, not exceptions. The dispatcher catches and reports thrown errors but the typed path is preferred.

The cross-transport parity test in `packages/core/src/workspace/cli/parity.test.ts` enforces both transports return the same payload for the same input.

## Custom routes

`route` defaults to `/api/cli/<name-with-spaces-as-slashes>`. Override only when migrating a legacy endpoint into the catalog.

## Troubleshooting

- Verb missing from `vobase --help`? Run `vobase --refresh` (the catalog is cached at `~/.vobase/<config>.cache.json`).
- `invalid_input` even though the schema looks right? Check that the CLI is coercing `--limit=10` to a number — the resolver auto-coerces based on the JSON Schema; verbs that declare `z.coerce.number()` instead of `z.number()` work too but the coercion is redundant.
- Body throws `service not installed`? The verb body ran before its module's `init` hook fired. Make sure the module's `requires:` list includes any module whose service the verb body calls.
