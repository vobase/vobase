---
"@vobase/core": minor
---

# Realtime: dedicated LISTEN DSN for pooled deployments

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
