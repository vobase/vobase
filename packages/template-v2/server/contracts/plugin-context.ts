/**
 * `PluginContext` — THE module contract.
 *
 * Every module's `init(ctx: PluginContext)` receives this. Replaces the old
 * `getModuleDeps()` singleton. All cross-module access flows through typed ports;
 * direct schema imports across modules are forbidden (enforced by
 * `scripts/check-module-shape.ts`).
 */

import type { ChannelAdapter } from '@vobase/core'
import type { CaptionPort } from './caption-port'
import type { AgentEvent, LlmTask } from './event'
/** Opaque transaction handle passed through from Drizzle. */
export type Tx = unknown

import type { AgentMutator } from './mutator'
import type { AgentObserver, Logger } from './observer'
import type { ScopedDb } from './scoped-db'
import type { SideLoadContributor, WorkspaceMaterializer } from './side-load'
import type { AgentTool } from './tool'
import type { ToolResult } from './tool-result'
import type { WakeContext } from './wake-context'

export type ObserverFactory = (wake: WakeContext) => AgentObserver

// Canonical AgentTool + ToolContext live in `./tool`. Re-export so module code
// can continue importing from `@server/contracts/plugin-context` without the
// contracts layer carrying a duplicate stub.
export type { AgentTool, ToolContext } from './tool'

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

/** LLM call chokepoint — see `PluginContext.llmCall` docs below. */
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

/**
 * Scheduler enqueue options — superset of pg-boss shape used across modules.
 * Optional `startAfter`/`singletonKey` match pg-boss semantics.
 */
export interface ScheduleOpts {
  startAfter?: Date
  singletonKey?: string
}

/**
 * pg-boss-shaped handle, namespace-enforced per-module.
 *
 * The raw scheduler passed in at boot has no notion of queue ownership; the
 * runtime wraps it with `buildScopedScheduler(raw, allowedQueues)` so a module
 * declaring `manifest.queues = ['snooze']` can `ctx.jobs.send('snooze', …)`
 * but `ctx.jobs.send('other-module.queue', …)` throws `NamespaceViolationError`.
 * Modules that do NOT declare `manifest.queues` get the raw scheduler
 * unchanged (opt-in during Phase 0 migration window).
 */
export interface ScopedScheduler {
  send(name: string, data: unknown, opts?: ScheduleOpts): Promise<string>
  cancel(jobId: string): Promise<void>
  schedule?(name: string, cron: string, data?: unknown, opts?: ScheduleOpts): Promise<string>
}

/**
 * Minimal bucket handle — covers the shapes `_storage` adapters expose today.
 * Expanded by Phase 1 when a named consumer of `ScopedStorage` materializes.
 */
export interface BucketHandle {
  put(key: string, body: unknown, opts?: { contentType?: string }): Promise<void>
  get(key: string): Promise<unknown>
  delete(key: string): Promise<void>
}

/**
 * `_storage` wrapper namespace-enforced per-module. Like `ScopedScheduler`,
 * the runtime wraps the raw storage with `buildScopedStorage(raw, allowedBuckets)`
 * so a module declaring `manifest.buckets = ['attachments']` can resolve
 * `ctx.storage.getBucket('attachments')` but not sibling-module buckets.
 */
export interface ScopedStorage {
  getBucket(name: string): BucketHandle
}

export interface EventBus {
  publish(event: AgentEvent): void
  subscribe(fn: (event: AgentEvent) => void | Promise<void>): () => void
}

export interface RealtimeService {
  notify(payload: { table: string; id?: string; action?: string }, tx?: Tx): void
  /** In-process fanout for SSE consumers. Returns an unsubscribe function. */
  subscribe(fn: (payload: string) => void): () => void
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

  /** Caption adapter — has real alternate impls (throw-proxy dev, Gemini prod). */
  readonly caption: CaptionPort

  /** Registration surface (called during init only) */
  registerTool(tool: AgentTool): void
  registerSkill(opts: { name: string; path: string }): void
  registerCommand(cmd: CommandDef): void
  registerChannel(type: string, adapter: ChannelAdapter): void
  registerObserver(observer: AgentObserver): void
  /**
   * Register an observer factory that is invoked ONCE per wake with a live
   * `WakeContext`. Use this when the observer needs per-wake bindings such as
   * `ctx.llmCall` or `ctx.events.publish` that are boot-time throw-proxies.
   */
  registerObserverFactory(factory: ObserverFactory): void
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

  /**
   * Transactional write path with mandatory journal append.
   *
   * Begins a drizzle tx, runs `fn` with an idempotent `journal` sink, and
   * throws `MissingJournalAppendError` on commit if `journal.append` was never
   * invoked inside the tx. Phase 0 is opt-in: existing service files may keep
   * using `db.transaction(...)` until their module migrates (Steps 6+).
   */
  withJournaledTx<T>(fn: (tx: Tx, journal: JournalSink) => Promise<T>): Promise<T>
}

/**
 * Journal sink handed to the inner callback of `withJournaledTx`. Calling
 * `append` (any number of times) marks the tx as journaled; missing calls
 * cause the tx wrapper to throw at commit time.
 */
export interface JournalSink {
  append(event: AgentEvent, tx: Tx): Promise<void>
}

export type { LlmTask } from './event'
