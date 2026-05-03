/**
 * Cross-module type primitives + state-machine helper + drizzle pgSchema
 * instances.
 *
 * The single shared backend "runtime contract": every module imports its
 * `ScopedDb`, `RealtimeService`, `ModuleDef` / `ModuleInitCtx` / `AuthHandle`,
 * `applyTransition`, and `pgSchema` references from here.
 *
 * Boot loop, dependency sorter, and collectors live in `@vobase/core` and are
 * imported directly from there. This file only narrows the generic core
 * contracts to the template's concrete `ScopedDb` and `RealtimeService` types
 * and adds the bootstrap-tier `auth: AuthHandle` field to ctx.
 */

import type { Auth } from '@auth'
import type { ModuleDef as CoreModuleDef, ModuleInitCtx as CoreModuleInitCtx } from '@vobase/core'
import { pgSchema } from 'drizzle-orm/pg-core'
import type { PostgresJsDatabase } from 'drizzle-orm/postgres-js'

import type { WakeContext } from '~/wake/context'
import type { LlmTask, WakeTrigger } from '~/wake/events'
import type { AppStorage } from './storage'

export type { AppStorage, BucketHandle, StorageEnv } from './storage'
export { createStorage } from './storage'
// Re-export the agent event aliases that modules import alongside the runtime
// types — saves them from a per-import vendor lookup.
export type { LlmTask, WakeTrigger }

// ─── Database handle ────────────────────────────────────────────────────────

/**
 * Contracts-level schema type. Each module owns its own `schema.ts`; the
 * cross-module contracts layer stays module-agnostic and uses the loose
 * record shape the drizzle postgres-js driver infers for a schema-less
 * `drizzle({ client })` call.
 */
export type Schema = Record<string, unknown>

/**
 * Organization-filtered drizzle handle. Structurally identical to
 * `PostgresJsDatabase<Schema>` — the alias exists so context types can be
 * distinguished from a raw drizzle client at the type level without
 * introducing runtime machinery.
 */
export type ScopedDb = PostgresJsDatabase<Schema>

/** Organization-filter helper shape consumed by service factories. */
export interface OrganizationScope {
  readonly organizationId: string
}

/** Opaque transaction handle passed through from Drizzle. */
export type Tx = unknown

// ─── Realtime ───────────────────────────────────────────────────────────────

/**
 * Realtime NOTIFY payload. `table` / `id` / `action` are the canonical fields
 * every emitter sets; resource-aware events (notably `change_proposals`)
 * additionally carry `resourceModule` / `resourceType` / `resourceId` /
 * `conversationId` so the client realtime hook can fan out to downstream caches.
 */
export interface NotifyPayload {
  table: string
  id?: string
  action?: string
  resourceModule?: string
  resourceType?: string
  resourceId?: string
  conversationId?: string | null
}

export interface RealtimeService {
  notify(payload: NotifyPayload, tx?: Tx): void
  subscribe(fn: (payload: string) => void): () => void
}

// ─── LLM call shape ─────────────────────────────────────────────────────────

import type { AgentTool } from '@vobase/core'

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

// ─── Module shape (narrowed) ────────────────────────────────────────────────

export type AuthHandle = Auth

export type ModuleInitCtx = CoreModuleInitCtx<ScopedDb, RealtimeService> & {
  readonly auth: AuthHandle
  readonly storage: AppStorage
}

/**
 * Template-narrowed `ModuleDef`. Overrides `init`'s ctx type to the extended
 * `ModuleInitCtx` (with `auth`) so module authors can read `ctx.auth` directly
 * inside their `init`. Method-parameter bivariance lets this still satisfy the
 * core `ModuleDef<Db, Realtime, TCtx>` signature when handed to `bootModules`.
 *
 * The third generic threads `WakeContext` (from `~/wake/context.ts`) into
 * `agent.materializers`, so each module's factory receives the template's
 * concrete wake-time bag rather than `unknown`.
 */
export type ModuleDef = Omit<CoreModuleDef<ScopedDb, RealtimeService, WakeContext>, 'init'> & {
  init(ctx: ModuleInitCtx): void | Promise<void>
}

// ─── State-machine helper ───────────────────────────────────────────────────

export interface TransitionTable<TStatus extends string> {
  /** Every allowed `from → to` edge. Edges not listed throw `InvalidTransitionError`. */
  readonly transitions: ReadonlyArray<{ from: TStatus; to: TStatus; event?: string }>
  readonly terminal: readonly TStatus[]
}

export class InvalidTransitionError extends Error {
  constructor(
    public readonly fromStatus: string,
    public readonly toStatus: string,
    public readonly tableName: string,
  ) {
    super(`invalid transition ${fromStatus} → ${toStatus} (table: ${tableName})`)
    this.name = 'InvalidTransitionError'
  }
}

export function applyTransition<TStatus extends string>(
  table: TransitionTable<TStatus>,
  current: TStatus,
  next: TStatus,
  tableName = 'unknown',
): TStatus {
  if (current === next) return current
  if (table.terminal.includes(current)) {
    throw new InvalidTransitionError(current, next, tableName)
  }
  const edge = table.transitions.find((t) => t.from === current && t.to === next)
  if (!edge) {
    throw new InvalidTransitionError(current, next, tableName)
  }
  return next
}

export function isTerminal<TStatus extends string>(table: TransitionTable<TStatus>, status: TStatus): boolean {
  return table.terminal.includes(status)
}

// ─── pgSchema instances ─────────────────────────────────────────────────────

/**
 * pgSchema instances for each domain module. Co-located so the drizzle
 * schema glob in `drizzle.config.ts` picks them up in one place and so
 * cross-module `.references()` are statically discoverable.
 */
export const contactsPgSchema = pgSchema('contacts')
export const teamPgSchema = pgSchema('team')
export const messagingPgSchema = pgSchema('messaging')
export const channelsPgSchema = pgSchema('channels')
export const agentsPgSchema = pgSchema('agents')
export const drivePgSchema = pgSchema('drive')
export const settingsPgSchema = pgSchema('settings')
export const viewsPgSchema = pgSchema('views')
export const schedulesPgSchema = pgSchema('schedules')
export const changesPgSchema = pgSchema('changes')
