# @vobase/cli

`vobase` is the standalone, catalog-driven CLI for any vobase deployment.

The binary has zero static knowledge of verbs. On the first command it asks
the tenant's `/api/cli/verbs` endpoint for the available verb set and caches
the result; every subsequent command resolves against the cached catalog.
This is what lets the same binary work across tenants whose module sets
differ — there's no per-tenant rebuild.

## Install

From npm (when published):

```sh
npm i -g @vobase/cli
# or, with bun
bun add -g @vobase/cli
```

From source (this repo):

```sh
cd packages/cli
bun run compile         # builds dist/vobase (single-file Mach-O / ELF binary)
ln -s "$(pwd)/dist/vobase" /usr/local/bin/vobase
```

## Authentication

Every CLI invocation reads its tenant URL + API key from
`~/.vobase/<config>.json`. The default config name is `config`; pass
`--config=<name>` (or set `VOBASE_CONFIG=<name>`) to switch.

```sh
# Browser device-grant flow — opens a /auth/cli-grant page on the tenant.
vobase auth login --url=https://acme.vobase.app

# Headless / scripted: pass the API key directly.
vobase auth login --url=https://acme.vobase.app --token=vbt_<key>

# Confirm.
vobase auth whoami
# → Principal: alice@acme.com (apikey)
#   Organization: org_acme
#   Role: admin
#   URL: https://acme.vobase.app

vobase auth logout       # removes ~/.vobase/<config>.json
```

The browser flow lands on `/auth/cli-grant?code=…` on the tenant and mints
an API key bound to the signed-in user. The CLI polls
`/api/auth/cli-grant/poll` until the code redeems, then writes the config
with `0600` permissions.

## Discovering verbs

`vobase --help` renders the catalog as verb groups; `vobase <group> --help`
narrows to a single group. Once the catalog is cached, `--help` is offline.

```sh
vobase --help
vobase contacts --help
vobase --refresh             # force-refetch the catalog (e.g. after a deploy)
```

## Running verbs

The starter verb set:

```sh
vobase contacts list
vobase contacts show --id=cnt_…
vobase contacts update --id=cnt_… --segments=qualified,vip

vobase messaging list --tab=active
vobase messaging show --id=cnv_…
vobase messaging reply --id=cnv_… --body="thanks for reaching out!"
vobase messaging close --id=cnv_… --reason="resolved"

vobase drive ls --scope=organization --path=/
vobase drive cat --scope=contact --scopeId=cnt_… --path=/NOTES.md
vobase drive write --scope=organization --path=/BUSINESS.md --content="..."

vobase agents list
vobase agents show --id=agt_…
vobase agents inspect --id=agt_…

vobase schedules list
vobase schedules enable  --id=sch_…
vobase schedules disable --id=sch_…
vobase schedules run     --id=sch_…   # force a single tick

vobase resources list
```

Add `--json` to any verb to get raw JSON output (overrides the catalog's
`formatHint`):

```sh
vobase contacts list --json | jq '.[].displayName'
```

## How the binary stays tenant-agnostic

The catalog endpoint publishes one entry per registered verb:

```jsonc
{
  "verbs": [
    {
      "name": "contacts list",
      "description": "List contacts in this organization.",
      "inputSchema": { "type": "object", "properties": { "limit": { "type": "integer" } } },
      "route": "/api/cli/contacts/list",
      "formatHint": "table:cols=id,displayName,email,phone,segments,createdAt"
    }
  ],
  "etag": "sha256-…"
}
```

The CLI:
1. Walks argv against verb names, longest-prefix wins (`vobase contacts list pending` → tries `contacts list pending`, then `contacts list`, then `contacts`).
2. Coerces `--key=value` flags to the JSON-Schema-declared types (`number`, `boolean`, comma-separated arrays).
3. Dispatches to the verb's `route` with `Authorization: Bearer <apiKey>`.
4. Renders the response through the `formatHint` (table / lines / json) or
   the format implied by `--json`.

If the server returns 412 (etag mismatch), the CLI swaps in the fresh
catalog body inline — no extra round-trip, no manual `--refresh` needed
when a tenant rolls out new verbs.

## Custom verbs (tenant-side)

Any module can register a verb with `defineCliVerb` + `ctx.cli.register(...)`.
Once it boots, the CLI binary picks it up on the next catalog refresh.

```ts
// in your module
import { defineCliVerb } from '@vobase/core'
import { z } from 'zod'

const widgetsList = defineCliVerb({
  name: 'widgets list',
  description: 'List widgets.',
  input: z.object({ limit: z.number().int().positive().default(20) }),
  body: async ({ input, ctx }) => ({
    ok: true as const,
    data: await widgets.list(ctx.organizationId, { limit: input.limit }),
  }),
  formatHint: 'table:cols=id,name,createdAt',
})

// ModuleDef.init
ctx.cli.register(widgetsList)
```

## Config file shape

`~/.vobase/<config>.json`:

```jsonc
{
  "url": "https://acme.vobase.app",
  "apiKey": "vbt_…",
  "organizationId": "org_acme",
  "principal": { "id": "usr_alice", "email": "alice@acme.com" }
}
```

The catalog cache lives next to it at `~/.vobase/<config>.cache.json`.

## Exit codes

- `0` — success
- `1` — verb returned an error or network/server failure
- `2` — auth or usage error (no config, missing required flag, unknown subcommand)
