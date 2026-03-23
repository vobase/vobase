---
"@vobase/core": minor
---

# Realtime SSE: Event-Driven Server-Push via LISTEN/NOTIFY

![Realtime SSE](https://raw.githubusercontent.com/vobase/vobase/main/.changeset/og-sse-realtime-0.22.0.png)

## RealtimeService

New core infrastructure service that bridges PostgreSQL LISTEN/NOTIFY to Server-Sent Events. Modules opt in by calling `ctx.realtime.notify()` after mutations — connected browsers receive events and automatically refetch stale data via TanStack Query invalidation.

### How It Works

| Layer | Component | What It Does |
|-------|-----------|-------------|
| Database | `NOTIFY vobase_events` | PostgreSQL fires event on channel after mutation |
| Server | `RealtimeService` | Listens on `vobase_events`, fans out to all SSE subscribers |
| Server | `GET /api/events` | SSE endpoint, session-authenticated, 25s heartbeat |
| Browser | `useRealtimeInvalidation()` | Bridges SSE events to `queryClient.invalidateQueries()` |

### Server API

```typescript
// Fire-and-forget (outside transaction)
await ctx.realtime.notify({ table: 'messaging-threads', id: thread.id, action: 'insert' })

// Transactional (NOTIFY fires only on commit, suppressed on rollback)
await ctx.db.transaction(async (tx) => {
  await tx.insert(threads).values(newThread)
  await ctx.realtime.notify({ table: 'messaging-threads', id: newThread.id, action: 'insert' }, tx)
})
```

### Client Integration

Zero per-query changes needed. The `useRealtimeInvalidation()` hook is mounted once in the app shell. It invalidates any TanStack Query whose `queryKey[0]` matches the NOTIFY payload's `table` field.

On reconnect after a connection drop, all queries are invalidated as a safety net to catch missed events.

## Database Support

| Environment | LISTEN Path | NOTIFY Path |
|-------------|-------------|-------------|
| PGlite (dev) | Native `pg.listen()` | `db.execute(sql\`SELECT pg_notify(...)\`)` |
| PostgreSQL (prod) | Dedicated `postgres.js` connection (`max: 1`) | Same Drizzle `db.execute` / `tx.execute` |

Both paths are internal to `createRealtimeService()` — module code never sees the branching.

Boot failure degrades gracefully to a no-op service (notify is silent, subscribe is a no-op). The app works without realtime.

## SSE Endpoint

`GET /api/events` — requires session cookie (better-auth). Returns `text/event-stream`.

| Event | Data | When |
|-------|------|------|
| `invalidate` | `{ "table": "messaging-threads", "id": "abc", "action": "insert" }` | After a module calls `ctx.realtime.notify()` |
| `ping` | empty | Every 25 seconds (keep-alive within `idleTimeout: 255`) |

## Reference Implementation

Messaging module handlers now emit NOTIFY after mutations:
- `POST /threads` — transactional insert + notify
- `DELETE /threads/:id` — transactional delete + notify
- `POST /threads/:id/chat` — title update notify
- `POST /contacts` — fire-and-forget notify

## Dependencies Added

| Package | Version | Purpose |
|---------|---------|---------|
| `postgres` | ^3.4.8 | Dedicated LISTEN connection for PostgreSQL (not needed for PGlite). Removable when `bun:sql` gains LISTEN/NOTIFY support (PR #25511). |

## Test Coverage

- **8 unit tests** — RealtimeService roundtrip, unsubscribe, fan-out, shutdown, no-op fallback (`realtime.test.ts`)
- **14 messaging handler tests** — updated with realtime mock, all passing (`handlers.test.ts`)
- **301 total tests pass**, 0 fail across 30 files
- **11 E2E tests** verified via curl: auth gate, SSE roundtrip, fan-out to multiple tabs, ping keep-alive, payload validation, disconnect resilience
