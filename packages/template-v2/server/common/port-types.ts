/**
 * Narrow port + primitive types previously co-located in
 * the old `server/contracts/plugin-context.ts` (since dissolved).
 *
 * The `PluginContext` mega-interface and `ObserverFactory` type were deleted
 * alongside the rest of slice 2c.3's bootstrap demolition — modules no longer
 * receive a bag-of-ports at boot. What remains here are the small types that
 * cross module boundaries and don't live naturally anywhere else: the LLM
 * chokepoint request/result shape, scoped scheduler/storage contracts, the
 * command surface for the workspace CLI, and the pg NOTIFY-backed
 * RealtimeService.
 */

import type { AgentEvent, LlmTask } from '@server/events'
import type { AgentTool, ChannelAdapter, ToolResult } from '@vobase/core'

export type { JobDef, ScheduleOpts, ScopedScheduler } from '@vobase/core'

/** Opaque transaction handle passed through from Drizzle. */
export type Tx = unknown

export type { ScopedDb } from '@server/common/scoped-db'
export type { LlmTask } from '@server/events'
export type { AgentTool, ToolContext } from '@vobase/core'

export interface CommandDef {
  name: string
  description: string
  usage?: string
  execute: (argv: readonly string[], ctx: CommandContext) => Promise<ToolResult<string>>
}

export interface CommandContext {
  organizationId: string
  conversationId: string
  agentId: string
  contactId: string
  writeWorkspace: (path: string, content: string) => Promise<void>
  readWorkspace: (path: string) => Promise<string>
}

export interface LlmRequest {
  model?: string
  provider?: string
  system?: string
  messages?: Array<{ role: 'user' | 'assistant' | 'system'; content: string }>
  tools?: AgentTool[]
  stream?: boolean
  signal?: AbortSignal
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

export interface BucketHandle {
  put(key: string, body: unknown, opts?: { contentType?: string }): Promise<void>
  get(key: string): Promise<unknown>
  delete(key: string): Promise<void>
}

export interface ScopedStorage {
  getBucket(name: string): BucketHandle
}

export interface EventBus {
  publish(event: AgentEvent): void
  subscribe(fn: (event: AgentEvent) => void | Promise<void>): () => void
}

export interface RealtimeService {
  notify(payload: { table: string; id?: string; action?: string }, tx?: Tx): void
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

export interface JournalSink {
  append(event: AgentEvent, tx: Tx): Promise<void>
}

/**
 * Type handle for a channel-adapter registration. Previously lived on
 * `PluginContext.registerChannel(type, adapter)`; the adapter surface itself
 * comes from @vobase/core.
 */
export type ChannelRegistration = { type: string; adapter: ChannelAdapter }
