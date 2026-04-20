/**
 * `PluginContext` — THE module contract.
 *
 * Every module's `init(ctx: PluginContext)` receives this. Replaces the old
 * `getModuleDeps()` singleton. All cross-module access flows through typed ports;
 * direct schema imports across modules are forbidden (enforced by
 * `scripts/check-module-shape.ts`).
 */

import type { ChannelAdapter } from '@vobase/core'
import type { AgentsPort } from './agents-port'
import type { CaptionPort } from './caption-port'
import type { ContactsPort } from './contacts-port'
import type { DrivePort } from './drive-port'
import type { AgentEvent, LlmTask } from './event'
import type { InboxPort, Tx } from './inbox-port'
import type { AgentMutator } from './mutator'
import type { AgentObserver, Logger } from './observer'
import type { ScopedDb } from './scoped-db'
import type { SideLoadContributor, WorkspaceMaterializer } from './side-load'
import type { ToolResult } from './tool-result'

/**
 * Minimal AgentTool shape — matches pi-agent-core's `AgentTool<Args, Result>` contract.
 * Kept as a local stub so the contracts layer doesn't require pi-agent-core at compile
 * time; Lane D's harness layer resolves the full type via `@mariozechner/pi-agent-core`.
 */
export interface AgentTool<TArgs = unknown, TResult = unknown> {
  name: string
  description: string
  /** TypeBox or Zod schema — harness adapts. */
  inputSchema: unknown
  outputSchema?: unknown
  /** Parallel execution safety — see `server/contracts/tool.ts` for full docs. */
  parallelGroup?: 'never' | 'safe' | { kind: 'path-scoped'; pathArg: string }
  execute: (args: TArgs, ctx: ToolExecutionContext) => Promise<ToolResult<TResult>>
}

export interface ToolExecutionContext {
  organizationId: string
  conversationId: string
  wakeId: string
  agentId: string
  turnIndex: number
  toolCallId: string
  signal?: AbortSignal
}

export interface CommandDef {
  name: string
  description: string
  usage?: string
  /** Called by the `vobase` CLI dispatcher in just-bash. */
  execute: (argv: readonly string[], ctx: CommandContext) => Promise<ToolResult<string>>
}

export interface CommandContext {
  organizationId: string
  conversationId: string
  agentId: string
  contactId: string
  /** Raw write to the virtual workspace. Used by `vobase memory set` etc. */
  writeWorkspace: (path: string, content: string) => Promise<void>
  readWorkspace: (path: string) => Promise<string>
}

/** LLM call chokepoint — see `server/runtime/llm-call.ts`. */
export interface LlmRequest {
  model?: string
  provider?: string
  system?: string
  messages?: Array<{ role: 'user' | 'assistant' | 'system'; content: string }>
  tools?: AgentTool[]
  stream?: boolean
  /** Cancellation signal — abort() cancels the in-flight LLM stream (Lane C). */
  signal?: AbortSignal
  /** Pass-through for any provider-specific opts. */
  providerOpts?: Record<string, unknown>
}

export interface LlmResult<T = string> {
  task: LlmTask
  model: string
  provider: string
  content: T
  tokensIn: number
  tokensOut: number
  cacheReadTokens: number
  costUsd: number
  latencyMs: number
  cacheHit: boolean
  finishReason?: string
}

/**
 * Scoped Drizzle DB handle — organization-filtered at the handler layer.
 * See `./scoped-db.ts`.
 */
export type { ScopedDb } from './scoped-db'

/** pg-boss handle, namespaced per-module. */
export type ScopedScheduler = unknown

/** `_storage` bucket wrapper scoped to this module. */
export type ScopedStorage = unknown

export interface EventBus {
  publish(event: AgentEvent): void
  subscribe(fn: (event: AgentEvent) => void | Promise<void>): () => void
}

export interface RealtimeService {
  notify(payload: { table: string; id?: string; action?: string }, tx?: Tx): void
}

export interface MetricSink {
  increment(name: string, value?: number, tags?: Record<string, string>): void
  gauge(name: string, value: number, tags?: Record<string, string>): void
  timing(name: string, ms: number, tags?: Record<string, string>): void
}

export type TraceSpan = {
  end(): void
  setAttribute(key: string, value: string | number | boolean): void
}

export interface PluginContext {
  /** Immutable identity */
  readonly moduleName: string
  readonly organizationId: string
  readonly conversationId: string

  /** Typed cross-module contracts — never raw schema imports */
  readonly ports: {
    inbox: InboxPort
    contacts: ContactsPort
    drive: DrivePort
    agents: AgentsPort
    caption: CaptionPort
  }

  /** Registration surface (called during init only) */
  registerTool(tool: AgentTool): void
  registerSkill(opts: { name: string; path: string }): void
  registerCommand(cmd: CommandDef): void
  registerChannel(type: string, adapter: ChannelAdapter): void
  registerObserver(observer: AgentObserver): void
  registerMutator(mutator: AgentMutator): void
  registerWorkspaceMaterializer(m: WorkspaceMaterializer): void

  /** Per-turn side-load contributor */
  contributeSideLoad(contrib: SideLoadContributor): void

  /** Scoped clients */
  readonly db: ScopedDb
  readonly jobs: ScopedScheduler
  readonly storage: ScopedStorage
  readonly events: EventBus
  readonly realtime: RealtimeService

  /** Observability primitives */
  readonly logger: Logger
  readonly metrics: MetricSink
  readonly trace: TraceSpan | null

  /** The task-tagged chokepoint for ALL LLM calls */
  llmCall<T = string>(task: LlmTask, request: LlmRequest): Promise<LlmResult<T>>
}

export type { LlmTask } from './event'
