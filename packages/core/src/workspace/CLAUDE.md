## workspace/

Primitives for a per-wake virtual filesystem that the agent navigates with native bash. Materializers pull from DB → in-memory FS; `ScopedFs` enforces the write rules; `DirtyTracker` diffs what the agent changed; `MaterializerRegistry` re-runs materializers for dirty paths after mutations; `generateAgentsMd()` synthesizes the agent's composite system document.

### The scope model (design convention, not an API)

Core provides the enforcement machinery (`buildReadOnlyConfig`, `isWritablePath`, `ScopedFs`, `ReadOnlyFsError`) but does not prescribe scope names. The template instantiates a 5-scope helpdesk convention. Apps built on core can reuse the names — or rename them to match their domain — as long as the write/read/proposal semantics stay consistent.

| Scope | Example paths (template) | Writable? | Lifetime | Mutation path |
|---|---|---|---|---|
| **Organization** | `/drive/**` | RO to agents | persistent | `vobase drive propose` → staff review |
| **Agent** | `/agents/<agentId>/MEMORY.md`, `/agents/<agentId>/skills/**` | direct (MEMORY via `vobase memory`), learning-flow (skills) | persistent | memory CLI / learning observer |
| **Contact** | `/contacts/<contactId>/MEMORY.md`, `/contacts/<contactId>/drive/**` | direct | persistent | memory CLI / direct writes |
| **Staff** | `/staff/<staffId>/MEMORY.md` | direct, scoped `(agent, staff)` | persistent | memory CLI |
| **Derived** | `/agents/<id>/AGENTS.md`, `/contacts/<id>/profile.md`, `/contacts/<id>/<channelId>/messages.md`, `/contacts/<id>/<channelId>/internal-notes.md`, `/staff/<id>/profile.md` | RO | per-wake regeneration | edit the source record, not the file |
| **Ephemeral** | `/tmp/**` | direct | wake | discarded at wake end |

Two rules the scope model encodes:

1. **Read-by-default, write-by-allowlist.** `buildReadOnlyConfig({ writablePrefixes, memoryPaths, readOnlyExact })` takes the allowlist; everything else is RO. Agents can `ls`, `cat`, `grep` anywhere they can reach.
2. **Derived files are RO and auto-regenerated.** The agent edits the source-of-truth (DB row, memory section, proposal queue), not the file. Materializers re-render on the next turn. `ReadOnlyFsError` messages explain the recovery path for each known derived file (AGENTS.md → edit `instructions`, profile.md → edit the record, messages.md → use the `reply` tool, …).

### Invariants

- **Materializers run before side-load, not before the system prompt.** Frozen-snapshot semantics: the agent sees turn-0 state in the system prompt; turn-N+1 writes appear in turn-N's side-load. Adding a materializer updates the *next* turn's FS, never the current one.
- **RO enforcement is scoped per wake.** Exact RO paths (`readOnlyExact`) and memory paths (`memoryPaths`) interpolate nanoids, so the config is built per wake with the active ids.
- **`innerWriteFile` is the harness's privileged write path.** Materializers that render into RO zones call `innerWriteFile` on `ScopedFs`; only the LLM's bash goes through the enforcing `writeFile`.
- **Identity lives in file contents, not folder names.** `AGENTS.md`, `profile.md`, and similar files open with `# <Display Name> (<nanoid>)` so the agent resolves id ↔ name once per wake.

### Adding a new scope

1. Pick a URL-like prefix (`/<scope>/<id>/...`).
2. Decide: writable (add to `writablePrefixes` in the template's `buildReadOnlyConfig` call), memory (add to `memoryPaths`), or derived (add exact paths to `readOnlyExact` and register a materializer).
3. If derived, register a materializer in `MaterializerRegistry` keyed on the scope prefix; the registry re-runs it when `DirtyTracker` flags a dependency.
4. If the RO message needs a scope-specific recovery hint, extend `renderRoError` in `ro-enforcer.ts` with a pattern match (drive, AGENTS.md, profile.md, messages.md, and internal-notes.md already have hints).
