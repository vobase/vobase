---
"@vobase/core": minor
---

Prune unused values from `MaterializerPhase` and `SideLoadKind`.

Two type-level enums shipped speculative values that were never wired up. After auditing every call site (template `modules/**`, core `harness/**`, `workspace/**`):

- **`MaterializerPhase`** narrows from `'frozen' | 'side-load' | 'on-read'` → **`'frozen'`**. Every production materializer fires once at `agent_start` (frozen-snapshot semantics — see `packages/core/src/workspace/CLAUDE.md`); the other two phases described a future capability never wired up. `MaterializerRegistry` collapses from a 3-bucket switch to a single-array push, dropping `getSideLoad()` / `getOnRead()` and the corresponding dead loop in `createWorkspace()`.
- **`SideLoadKind`** narrows from 6 named kinds (`working_memory`, `pending_approvals`, `delivery_status`, `internal_notes_delta`, `drive_hint`, `custom`) → **`'custom'`**. Every actual `kind:` literal across core + template uses `'custom'`; the named kinds were a planned taxonomy with no consumer. The field is retained on `SideLoadItem` so a future kind-aware renderer can re-introduce values when their consumers exist.

The narrower types tighten what new contributors see when they import these primitives — the API surface now reflects what's actually exercised. If a future feature needs the dropped phases or kinds, add them back with a real call site rather than as forward declarations.

`packages/template/scripts/check-module-shape.ts` updates `VALID_PHASES` to match.

No runtime behaviour change. All 555 core tests pass.
