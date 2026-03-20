---
"@vobase/core": minor
---

Upgrade pg-boss to v12 and @electric-sql/pglite to v0.4. Move both to peerDependencies so consumers stay version-aligned.

**pg-boss 12 breaking changes handled:**
- Named export (`import { PgBoss }`) — default export removed
- Queue names normalized from `module:job` to `module/job` (colon no longer allowed)
- `SendOptions` imported directly instead of `PgBoss.SendOptions`

**PGlite 0.4:**
- No API changes needed. Test helper added with golden dump pattern (`createTestPGlite()`) to avoid WASM OOM from parallel initdb — test suite 48s → 17s.

**Platform contract:**
- Generalized `POST /api/integrations/:provider/configure` with pass-through body envelope (frozen V1 contract)
