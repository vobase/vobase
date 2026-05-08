---
"@vobase/template": patch
"create-vobase": patch
---

Fix: silent in-process DB writes after a bash tool dispatch.

`just-bash`'s `DefenseInDepthBox.lockWellKnownSymbols()` redefines `Error.stackTraceLimit` as `writable: false` while a bash tool runs. The lock is global (not ALS-scoped), so any postgres transaction begun inside a bash-tool-dispatched verb hits `cachedError` (`postgres@3.4.9` `query.js:169`), which writes `Error.stackTraceLimit = 4` and throws `TypeError: Attempted to assign to readonly property`.

Symptom: `vobase contacts propose-change` (and any other in-process DB write under bash) failed silently for fresh contacts, while pre-cached SQL templates kept working — making the bug look like model variance.

Fix: `packages/template/main.ts` now pins `Error.stackTraceLimit` as `configurable: false` at process start, so just-bash's `Object.defineProperty` no-ops (caught by its own try/catch).

Also surfaces postgres `23505` unique violations as a typed `errorCode: 'unique_conflict'` in `vobase contacts propose-change`, and fixes the rename leftover in `tests/smoke/smoke-all-triggers-live.ts` that pointed at the never-renamed `smoke-staff-note-action-live.ts`.
