---
"@vobase/core": minor
---

# Promote harness + workspace primitives to `@vobase/core`

First half of the template-v2 → core migration. Adds the generic
harness/workspace building blocks so apps can stop owning their own
copies. No behaviour change for existing consumers; this PR only
publishes new exports.

## Added

**Harness primitives (`@vobase/core`):**

- `makeBashTool` — single typed `bash` `AgentTool` with three-layer
  (4KB preview / 100KB spill / 200KB turn-ceiling) byte budget.
- `TurnBudget`, `L1_PREVIEW_BYTES`, `L2_SPILL_BYTES`, `L3_CEILING_BYTES`
  — shared per-turn byte accounting.
- `spillToFile` — stdout spill helper emitting `tool_result_persisted`.
- `collectSideLoad`, `createBashHistoryMaterializer` — side-load zone
  composer + bash-history materializer.
- `createRestartRecoveryContributor` — one-shot side-load injection for
  interrupted prior wakes.
- `classifyError` — provider error → `ClassifiedError` mapping.
- `createSteerQueue` — between-turn steering queue.
- `newWakeId` — wake identifier minter.

**Workspace primitives (`@vobase/core`):**

- `ScopedFs`, `checkWriteAllowed`, `isWritablePath`, `buildReadOnlyConfig`,
  `WRITABLE_PREFIXES`, `ReadOnlyFsError` — RO enforcement around
  `just-bash`'s `InMemoryFs`.
- `DirtyTracker`, `snapshotFs` — writable-zone diff tracking.
- `MaterializerRegistry` — frozen / side-load / on-read materializer
  phases.
- `generateAgentsMd` — `/workspace/AGENTS.md` generator from registered
  `vobase` CLI commands.

**Generic types** (via the same barrel): `AgentTool`, `ToolContext`,
`ToolResult` (+ `OkResult`/`ErrResult`), `ToolResultPersistedEvent`,
`WorkspaceMaterializer`, `MaterializerCtx`, `MaterializerPhase`,
`SideLoadItem`, `SideLoadContributor`, `SideLoadCtx`, `SideLoadKind`,
`IterationBudget`, `BudgetPhase`, `BudgetState`, `ClassifiedError`,
`ClassifiedErrorReason`, `AbortContext`, `CommandDef`, `CommandContext`.

## Peer dependency

- `just-bash ^2.14.2` — the bash-tool + RO-enforcer are built on
  `just-bash`'s `IFileSystem` contract.
