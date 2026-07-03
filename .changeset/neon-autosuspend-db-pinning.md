---
"@vobase/core": minor
"@vobase/template": patch
---

Stop pinning Neon computes 24/7: subscriber-scoped realtime LISTEN + activity-gated active-wakes sweep

The realtime LISTEN connection now exists only while SSE subscribers are connected (with a 60s linger), and the 60s `SELECT 1` keepalive runs only while that connection is open. A persistent LISTEN pins a Neon compute at its CU floor regardless of keepalive cadence — autosuspend kills the idle socket, postgres.js eagerly re-issues LISTEN, and the connection attempt re-wakes the compute — so scoping the connection to subscribers is the only shape that lets an idle tenant sleep. Delivery-gap safety (the PR #61 silent-SSE-blackout fix) is preserved and strengthened: the keepalive still prevents mid-session drops, the service now broadcasts a `{ table: '*' }` resync whenever LISTEN (re)establishes, `RealtimeService.ready()` lets the SSE route hold `connected` until the transport is up, and the template client refetches everything on SSE reconnect. `sweepStaleActiveWakes` gates itself on in-process lease activity, so the template's unconditional 60s sweep interval no longer touches the database while no wakes are running. Template pool now closes idle connections (`idle_timeout: 20`). New env knobs: `VOBASE_REALTIME_LISTEN_LINGER_MS` (default 60000), `VOBASE_REALTIME_EAGER_LISTEN=1` (pre-0.44 always-on LISTEN for self-hosted Postgres).
