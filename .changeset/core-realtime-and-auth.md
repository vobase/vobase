---
"@vobase/core": minor
---

# Realtime LISTEN DSN + auth id generation + idempotent auto-join

Three focused core changes shipped together.

## Realtime: dedicated LISTEN DSN for pooled deployments

The realtime service (`createRealtimeService` / `createApp`) now accepts an
optional dedicated DSN for its LISTEN connection. This fixes silent SSE
blackouts on Neon and any PgBouncer-fronted deploy where the app pool runs
in transaction mode.

## Why

PgBouncer in transaction mode multiplexes statements across backend sessions
— `pg_notify` on one session and `LISTEN` on another never meet, so realtime
events silently vanish. On Neon specifically, the default `DATABASE_URL`
points at the `-pooler` endpoint, which triggered exactly this: `notify`
fires, `dispatch` never does, and the inbox stops live-updating.

The fix is to route just the single persistent LISTEN connection at a
non-pooler DSN while app queries keep hitting the pool for connection
headroom.

## API

`createRealtimeService` takes a third options argument:

```ts
import { createRealtimeService } from '@vobase/core';

const realtime = await createRealtimeService(
  process.env.DATABASE_URL!, // pooled — used for app queries
  db,
  { listenDsn: process.env.DATABASE_URL_DIRECT }, // direct — used for LISTEN
);
```

`CreateAppConfig` gains a matching `databaseDirect` field, so apps wired
through `createApp` only need a config tweak:

```ts
const config: CreateAppConfig = {
  database: process.env.DATABASE_URL!,
  databaseDirect: process.env.DATABASE_URL_DIRECT, // optional
  modules: [...],
};
```

Both options default to reusing the main DSN when unset — self-hosted
Postgres and PGlite deployments need no changes.

## Migration

- **Self-hosted Postgres / local dev**: no action required.
- **Neon**: add a `DATABASE_URL_DIRECT` env var pointing at the direct
  endpoint (strip `-pooler` from the pooled host), then set
  `databaseDirect: process.env.DATABASE_URL_DIRECT` in `vobase.config.ts`.
  The template's `.env.example` documents the exact format.
- **Other PgBouncer setups**: same pattern — point `DATABASE_URL_DIRECT`
  at a connection path that preserves session state.

## Auth: Better-Auth id generation aligned with domain tables

`createAuthModule` now sets `advanced.database.generateId` to the same
`createNanoid()` generator used by `nanoidPrimaryKey()`, so Better-Auth-minted
ids (`user`, `session`, `account`, `member`, `invitation`, `team`, `verification`,
`apikey`) use the same 8-char lowercase-alphanumeric alphabet as every domain
table. No DB extension dependency, no schema change — new rows only. The CLI
config at `packages/core/auth.ts` applies the same override so regenerated
schemas match runtime behavior.

## Auth: idempotent auto-join

`autoJoinUser` now uses `onConflictDoNothing` on `(userId, organizationId)`
for both the pending-invitation and sole-org domain-match insert paths. The
`member` table carries a `uniqueIndex('member_user_org_unique_idx')`, so the
previous plain insert raised a unique-violation whenever auto-join fired twice
for the same signup (e.g. once from `user.create.after` and again from
`session.create.before` in downstream configs). The guard silences the noise
without changing semantics — one membership per (user, org) is already the
invariant.
