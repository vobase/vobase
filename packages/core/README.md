# @vobase/core

Core runtime for [Vobase](https://github.com/vobase/vobase) — the app framework built for AI coding agents.

Provides the module system, agent harness contract, workspace primitives (virtual filesystem, RO enforcer, AGENTS.md generator), CLI verb registry, auth/audit/storage/channel adapter contracts, jobs, and persistence helpers.

## Installation

```bash
bun add @vobase/core
```

## Module canonical shape

Every Vobase module is a `ModuleDef` from `module.ts` that aggregates sibling files. The agent-facing seams sit under one declarative slot:

```typescript
import { defineModule } from '@vobase/core'

export default defineModule({
  name: 'my-module',
  requires: ['contacts'],
  schema, web, jobs, init,
  agent: {
    agentsMd: [...],          // IndexContributor[] — AGENTS.md fragments
    materializers: [factory], // WorkspaceMaterializerFactory<TCtx>[]
    roHints: [...],           // RoHintFn[] — chained by chainRoHints
    tools: [...],             // AgentTool[] with audience/lane/prompt
  },
})
```

`bootModules` topologically sorts by `requires` and produces an `AgentContributions<TCtx>` bag that wake builders consume. `TCtx` is template-specialized (the helpdesk template threads its `WakeContext` through it).

## Agent tool metadata

`AgentTool` carries three wake-time policy fields:

- `audience: 'customer' | 'internal'` — wake builders strip customer-facing tools on supervisor coaching wakes.
- `lane: 'conversation' | 'standalone' | 'both'` — partitions the catalogue between conversation-bound and operator-thread/heartbeat wakes.
- `prompt?: string` — colocated AGENTS.md guidance rendered under `## Tool guidance` next to the tool name.

Use `defineAgentTool({ ... })` to collapse the validation/error-mapping boilerplate.

## Workspace CLI

A unified `CliVerbRegistry` is the single surface for verbs. The same body runs:

- inside the agent's bash sandbox (in-process transport, via `createBashVobaseCommand`)
- over HTTP-RPC from the standalone `@vobase/cli` binary (catalog route)

Modules register verbs at `init` via `ctx.cli.register(defineCliVerb({ ... }))` or `registerAll([...])`. Set `audience: 'agent' | 'staff' | 'all'` to gate which transports see the verb. The CLI dispatcher coerces `--flag=value` argv into the JSON-Schema-declared types so verb schemas can use strict `z.number()` / `z.boolean()`.

## What's exported

- **Harness**: `createHarness`, `AgentTool`, `ToolContext`, `ToolResult`, `AgentEvent`, `HarnessEvent`, `WakeScope`, `SideLoadContributor`, `WorkspaceMaterializer`, `WorkspaceMaterializerFactory<TCtx>`, `defineAgentTool`, `DirtyTracker`
- **Modules**: `defineModule`, `bootModules`, `collectAgentContributions`, `ModuleDef`, `ModuleInitCtx`, `AgentContributions`, `RoHintFn`
- **Workspace**: `generateAgentsMd`, `defineIndexContributor`, `buildReadOnlyConfig`, `ScopedFs`, `MaterializerRegistry`
- **CLI**: `CliVerbRegistry`, `defineCliVerb`, `createBashVobaseCommand`, `createCatalogRoute`, `createCliDispatchRoute`, `createInProcessTransport`
- **Adapters**: `ChannelAdapter`, `StorageAdapter`, `AuthAdapter` contracts; `createLocalAdapter` / `createS3Adapter`
- **Schemas + helpers**: `auditLog`, `recordAudits`, `sequences`, `storageObjects`, `nanoidPrimaryKey`, `nextSequence`, `trackChanges`, `signHmac`, `verifyHmacSignature`, `journalAppend`, etc.
- **Errors**: `notFound`, `unauthorized`, `forbidden`, `conflict`, `validation`, `dbBusy`

## Compatibility notes

`@vobase/core` runs primarily under Bun. The `postgres://` branch of `createDatabase` requires `Bun.SQL`; both `Bun.SQL` and `drizzle-orm/bun-sql` are loaded lazily at call time so the schema graph stays Node-loadable for `drizzle-kit`. Tests use PGlite (`memory://`) under either runtime.

## License

MIT
