/**
 * Factory that assembles a `PluginContext` for a single module's `init(ctx)`.
 * Spec §6.1 + plan §P1.1. Phase 3 (plan §P3.0) threads a real `ScopedDb` —
 * callers pass the drizzle handle from the module boot slot; the factory
 * forwards it to every module's `init(ctx).db` unchanged. Existing
 * `jobs`/`storage`/`events`/`realtime`/`llmCall` slots from Phase 2 P2.0
 * stay wired as-is.
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
  tenantId: string
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

/** Returns `{ ctx, registrations }` — pass `ctx` to `module.init(ctx)` and then read drained registrations. */
export function createPluginContext(input: PluginContextFactoryInput): {
  ctx: PluginContext
  registrations: ModuleRegistrations
} {
  const registrations = emptyRegistrations()

  const ctx: PluginContext = {
    moduleName: input.moduleName,
    tenantId: input.tenantId,
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
