---
"@vobase/template": patch
---

# Drop epoch-stamped skip cache from test-db helper

`tests/helpers/test-db.ts` cached `bun run db:reset` results via a 5-second `RUN_EPOCH` sentinel — files whose `beforeAll` landed within the same epoch as a successful reset would skip resetting. Sound for deduplicating parallel-worker setup, but unsound for tests that mutate seed rows: any DELETE/UPDATE in one file polluted the seeded DB for every later file inside the same epoch window. Manifested as order-dependent FK violations (`messaging.conversations.contact_id → contacts.contacts(id)`) and an anonymous `(unnamed)` mid-suite `db:push failed` whose 5-second duration matched the epoch bucket.

Drop the cache. Every test file's `beforeAll` now reseeds unconditionally under the existing flock. No DB-lifecycle issues — `bun run db:reset` works fine even when other test processes hold open `postgres` connections (verified empirically with sequential subprocess invocations).

**Suite impact**: 0 failures (was 4); 67-71s runtime (was ~8s, but with 4 polluted-state failures). Stable across 3 consecutive runs. If suite latency becomes a concern, the next iteration is in-process `TRUNCATE ... CASCADE` + reseed using the existing module `seed(db)` exports — same correctness, sub-second per file.

Resolves #69.
