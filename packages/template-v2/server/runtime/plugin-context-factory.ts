/**
 * Factory that assembles a `PluginContext` for a single module's `init(ctx)`.
 * Phase 3 threads a real `ScopedDb` — callers pass the drizzle handle from
 * the module boot slot; the factory forwards it to every module's `init(ctx).db`
 * unchanged.
 */

import type { LlmTask } from '@server/contracts/event'
import type { AgentMutator } from '@server/contracts/mutator'
import type { AgentObserver, Logger } from '@server/contracts/observer'
import type {
  AgentTool,
  CommandDef,
  EventBus,
  LlmRequest,
  LlmResult,
  MetricSink,
  PluginContext,
  RealtimeService,
  ScopedDb,
  ScopedScheduler,
  ScopedStorage,
  TraceSpan,
} from '@server/contracts/plugin-context'
import type { SideLoadContributor, WorkspaceMaterializer } from '@server/contracts/side-load'
import type { ChannelAdapter } from '@vobase/core'

export interface ModuleRegistrations {
  tools: AgentTool[]
  skills: Array<{ name: string; path: string }>
  commands: CommandDef[]
  channels: Array<{ type: string; adapter: ChannelAdapter }>
  observers: AgentObserver[]
  mutators: AgentMutator[]
  materializers: WorkspaceMaterializer[]
  sideLoadContributors: SideLoadContributor[]
}

export function emptyRegistrations(): ModuleRegistrations {
  return {
    tools: [],
    skills: [],
    commands: [],
    channels: [],
    observers: [],
    mutators: [],
    materializers: [],
    sideLoadContributors: [],
  }
}

export interface PluginContextFactoryInput {
  moduleName: string
  organizationId: string
  conversationId: string
  ports: PluginContext['ports']
  db: ScopedDb
  jobs: ScopedScheduler
  storage: ScopedStorage
  events: EventBus
  realtime: RealtimeService
  logger: Logger
  metrics: MetricSink
  trace?: TraceSpan | null
  llmCall: <T = string>(task: LlmTask, request: LlmRequest) => Promise<LlmResult<T>>
}

/**
 * Boot-time input — `init(ctx)` runs ONCE at server startup, before any wake
 * exists, so per-wake fields (`organizationId`, `conversationId`, `events`, `llmCall`)
 * are unavailable. The returned ctx throws on those fields so modules that
 * mistakenly reach for them at boot fail loudly instead of silently capturing
 * a stub.
 *
 * `organizationId` is deliberately the empty string at boot. `drive/service/proposal.ts`
 * and similar organization-scoped writers guard with `if (!_tenantId) throw`, so an
 * empty sentinel surfaces as a clear error if those code paths are reached
 * outside a per-organization request context. Do not change to a dummy value.
 */
export interface BootContextInput {
  moduleName: string
  ports: PluginContext['ports']
  db: ScopedDb
  jobs: ScopedScheduler
  storage: ScopedStorage
  realtime: RealtimeService
  logger: Logger
  metrics: MetricSink
}

/** Returns `{ ctx, registrations }` — pass `ctx` to `module.init(ctx)` and then read drained registrations. */
export function createBootContext(input: BootContextInput): {
  ctx: PluginContext
  registrations: ModuleRegistrations
} {
  const bootOnlyThrow = (field: string): never => {
    throw new Error(
      `PluginContext.${field} accessed during boot — only available inside a wake. ` +
        `If you need this at register time, capture a lazy reference instead.`,
    )
  }
  return createPluginContext({
    moduleName: input.moduleName,
    organizationId: '',
    conversationId: '',
    ports: input.ports,
    db: input.db,
    jobs: input.jobs,
    storage: input.storage,
    events: {
      publish: () => bootOnlyThrow('events.publish'),
      subscribe: () => bootOnlyThrow('events.subscribe'),
    },
    realtime: input.realtime,
    logger: input.logger,
    metrics: input.metrics,
    trace: null,
    llmCall: () => bootOnlyThrow('llmCall'),
  })
}

/** Returns `{ ctx, registrations }` — pass `ctx` to `module.init(ctx)` and then read drained registrations. */
export function createPluginContext(input: PluginContextFactoryInput): {
  ctx: PluginContext
  registrations: ModuleRegistrations
} {
  const registrations = emptyRegistrations()

  const ctx: PluginContext = {
    moduleName: input.moduleName,
    organizationId: input.organizationId,
    conversationId: input.conversationId,
    ports: input.ports,

    registerTool(tool) {
      registrations.tools.push(tool)
    },
    registerSkill(opts) {
      registrations.skills.push(opts)
    },
    registerCommand(cmd) {
      registrations.commands.push(cmd)
    },
    registerChannel(type, adapter) {
      registrations.channels.push({ type, adapter })
    },
    registerObserver(observer) {
      registrations.observers.push(observer)
    },
    registerMutator(mutator) {
      registrations.mutators.push(mutator)
    },
    registerWorkspaceMaterializer(m) {
      registrations.materializers.push(m)
    },

    contributeSideLoad(contrib) {
      registrations.sideLoadContributors.push(contrib)
    },

    db: input.db,
    jobs: input.jobs,
    storage: input.storage,
    events: input.events,
    realtime: input.realtime,
    logger: input.logger,
    metrics: input.metrics,
    trace: input.trace ?? null,

    llmCall: input.llmCall,
  }

  return { ctx, registrations }
}
