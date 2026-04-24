---
'@vobase/core': minor
'@vobase/template-v2': patch
---

Promote runtime primitives from `packages/template-v2` to `@vobase/core` so Slice 4b's `declarative-module-collector` can consume them.

**New public API on `@vobase/core`:**

- `WakeRuntime = { fs: IFileSystem; tracker: DirtyTracker }` — a minimal fixed shape, not a grab-bag.
- `ModuleDef<Db, Realtime>`, `ModuleInitCtx<Db, Realtime>`, `ModuleRoutes`, `InvalidModuleError`, `sortModules`, `bootModules` (with `bootModulesCollector` alias) — module contract and boot loop.
- `ModuleDef` gains three optional grouped surfaces (`web`, `agent`, `jobs`). The legacy top-level `routes?` field stays for the Slice 4b migration window.
- `collectAgentContributions`, `collectWebRoutes`, `collectJobs` — dormant collectors that flatten the declarative surfaces. Not consumed by the template yet.
- `ScopedScheduler`, `JobDef`, `ScheduleOpts` — scheduler types.
- `llmCall`, `LlmCallArgs`, `LlmEmitter`, `LlmRequest`, `LlmResult` — moved from `packages/template-v2/server/harness/llm-call.ts`. Core's signature accepts `model: Model<any>` + `apiKey?: string` directly (no env-var coupling); template's thin wrapper still resolves those via its `llm-provider` seam.

**Breaking change:**

- `OnEventListener<T>` gains a second argument: `(event: HarnessEvent<T>, runtime: WakeRuntime) => void | Promise<void>`. `OnToolCallListener` / `OnToolResultListener` extended the same way.
- `CreateHarnessOpts<T>` now requires `runtime: WakeRuntime`.
- Existing one-arg listeners remain assignable via TypeScript's function-arity subtyping, so no template listener bodies change. External consumers of `@vobase/core` (none known) must update listener implementations if they want the new value.

**Template-side impact (patch-level):**

- Template keeps its existing import paths; `server/common/module-def.ts` and `server/common/port-types.ts` become thin re-export barrels that bind the core generics to `ScopedDb` / `RealtimeService`.
- `server/wake-handler.ts` builds `{ fs: workspace.innerFs, tracker: dirtyTracker } satisfies WakeRuntime` and passes it to `createHarness`.
- `tests/helpers/test-harness.ts` constructs the same `WakeRuntime` for integration tests.
- No behavior change. System prompt hash unchanged.

Unblocks `declarative-module-collector` (Slice 4b).
