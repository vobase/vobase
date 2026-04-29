/**
 * Generic harness + workspace contracts.
 *
 * Concrete `AgentEvent` unions (with domain event variants) are owned by each
 * app; core ships only the primitives every harness consumer needs: tool
 * envelope, tool context, tool result, side-load/materializer shapes, budget +
 * classifier + abort carriers, plus the `tool_result_persisted` event shape
 * (emitted by the spill logic via a callback).
 */

import type { IFileSystem } from 'just-bash'

import type { DirtyTracker } from '../workspace/dirty-tracker'

// ─── Wake state ─────────────────────────────────────────────────────────────

/**
 * Lifecycle state a wake can be in. The harness emits journal events at every
 * transition; consumers can derive the current state by reading the latest
 * `wake_state_changed` event for a wakeId, but most callers simply read this
 * union when scheduling resume/abort logic.
 *
 * - `'running'`         : turn loop is live (or about to be).
 * - `'pending_approval'`: paused because a tool requires `requiresApproval`
 *                         and a user hasn't yet decided. `harness.pending_approvals`
 *                         carries the persisted context the resumer needs.
 * - `'completed'`       : reached a terminal `agent_end`.
 * - `'aborted'`         : reached `agent_aborted` (steer, supervisor, error).
 * - `'awaiting_resume'` : approval resolved, awaiting the wake-resumer job to
 *                         re-acquire the lease and resume.
 */
export type WakeState = 'running' | 'pending_approval' | 'awaiting_resume' | 'completed' | 'aborted'

// ─── Wake runtime ───────────────────────────────────────────────────────────

/**
 * Per-wake runtime handle threaded to every `OnEventListener` invocation. The
 * two fields are the genuinely wake-scoped bits that don't live on
 * `HarnessBaseFields`: the virtual filesystem the agent sees this wake, and
 * the dirty tracker watching mutations inside writable zones. Identity fields
 * (`organizationId`, `agentId`, `contactId`, `conversationId`, `wakeId`) live
 * on the event. Services (drive, messaging, …) are boot-time singletons in
 * the consuming application.
 */
export interface WakeRuntime {
  fs: IFileSystem
  tracker: DirtyTracker
}

/**
 * Channel-specific authoring guidance surfaced in the frozen system prompt.
 *
 * Template owns the catalog — core exports only the type so frozen-prompt
 * builders and tests share a common shape. `kind` matches the
 * `channelInstance.type` discriminator the template uses; `hint` is rendered
 * verbatim under a `## Platform hints` section.
 */
export interface HarnessPlatformHint {
  kind: string
  hint: string
}

// ─── Tool envelope ──────────────────────────────────────────────────────────

export interface ToolContext {
  organizationId: string
  conversationId: string
  wakeId: string
  agentId: string
  turnIndex: number
  toolCallId: string
  approvalDecision?: {
    decision: 'approved' | 'rejected'
    note?: string
    decidedByUserId?: string
  }
}

export type ToolResult<T = unknown> =
  | {
      ok: true
      content: T
      persisted?: { path: string; size: number; preview: string }
    }
  | {
      ok: false
      error: string
      errorCode?: string
      retryable?: boolean
      details?: unknown
    }

export type OkResult<T> = Extract<ToolResult<T>, { ok: true }>
export type ErrResult = Extract<ToolResult<never>, { ok: false }>

export interface AgentTool<TArgs = unknown, TResult = unknown> {
  name: string
  description: string
  inputSchema: unknown
  outputSchema?: unknown
  requiresApproval?: boolean
  parallelGroup?: 'never' | 'safe' | { kind: 'path-scoped'; pathArg: string }
  /**
   * Safe to replay after a process restart? If `true`, the restart-recovery
   * driver re-dispatches an orphaned `tool_dispatch_started` whose
   * `tool_dispatch_completed` never arrived. If `false` (default) the wake
   * aborts with `tool_dispatch_lost`.
   */
  idempotent?: boolean
  /**
   * Hard cap on concurrent in-flight dispatches of this tool within a single
   * wake. Defaults to `1` (serialized). Use `Infinity` only for genuinely
   * commutative read-only tools — most write paths should leave this at 1.
   */
  maxConcurrent?: number
  /**
   * Audience signal consumed by wake-time policy filters (e.g. supervisor-wake
   * coaching mode strips customer-facing tools so a staff coaching note can't
   * trigger another customer reply).
   *
   * - `'customer'`: this tool produces something the customer sees directly
   *   (reply, send_card, send_file, book_slot).
   * - `'internal'` (default): staff-only or pure read; safe to expose under
   *   coaching/peer-consultation contexts.
   *
   * Owned by the module that ships the tool — the wake builder reads this
   * metadata so it never has to know specific tool names.
   */
  audience?: 'customer' | 'internal'
  /**
   * Wake-lane partition. The wake builder filters `AgentContributions.tools`
   * by this field so each lane (conversation vs. standalone) sees only its own
   * surface, with `'both'` opting a tool into both. Owned by the module that
   * ships the tool — wake builders never need to know specific tool names.
   */
  lane?: 'conversation' | 'standalone' | 'both'
  /**
   * Tool-specific prose for the agent's AGENTS.md `## Tool guidance` block.
   * Rendered under a `### <tool-name>` heading. Use for "when to call this",
   * preferred-over-alternatives, gotchas — colocated with the tool body so
   * renames and behaviour changes can't drift from the prompt. Tools without
   * a `prompt` are omitted from the section entirely.
   */
  prompt?: string
  execute(args: TArgs, ctx: ToolContext): Promise<ToolResult<TResult>>
}

// ─── Tool-result persistence event (emitted via callback, not a full union) ─

export interface ToolResultPersistedEvent {
  type: 'tool_result_persisted'
  ts: Date
  wakeId: string
  conversationId: string
  organizationId: string
  turnIndex: number
  toolCallId: string
  toolName: string
  /** Absolute path inside /tmp/ where the full result was spilled. */
  path: string
  originalByteLength: number
}

// ─── Governance events (emitted by approval-gate / cost-cap / state machine)

/** Common identity carried on every governance journal event. */
interface GovernanceEventBase {
  ts: Date
  wakeId: string
  conversationId: string
  organizationId: string
  turnIndex: number
}

/** A tool with `requiresApproval` was about to dispatch and is now paused. */
export interface ApprovalRequestedEvent extends GovernanceEventBase {
  type: 'approval_requested'
  toolCallId: string
  toolName: string
  requestedByAgentId: string
  /** Frozen tool input; replayed verbatim when approval resolves. */
  toolInput: unknown
  /** Optional human-readable summary of why approval is needed. */
  reason?: string
}

/** A staff member resolved a pending approval. */
export interface ApprovalResolvedEvent extends GovernanceEventBase {
  type: 'approval_resolved'
  toolCallId: string
  decision: 'approved' | 'rejected'
  decidedByUserId: string
  note?: string
}

/** Soft (80%) or hard (100%) cost ceiling hit — emitted before any pause. */
export interface CostThresholdCrossedEvent extends GovernanceEventBase {
  type: 'cost_threshold_crossed'
  phase: BudgetPhase
  spentUsd: number
  ceilingUsd: number
}

/** Wake transitioned between states. The driver writes one of these per change. */
export interface WakeStateChangedEvent extends GovernanceEventBase {
  type: 'wake_state_changed'
  from: WakeState
  to: WakeState
  reason?: string
}

/** Tool dispatch began — paired with `tool_dispatch_completed` via toolCallId / idempotencyKey. */
export interface ToolDispatchStartedEvent extends GovernanceEventBase {
  type: 'tool_dispatch_started'
  toolCallId: string
  toolName: string
  idempotencyKey: string
}

/** Tool dispatch completed (either success or failure). */
export interface ToolDispatchCompletedEvent extends GovernanceEventBase {
  type: 'tool_dispatch_completed'
  toolCallId: string
  toolName: string
  idempotencyKey: string
  ok: boolean
  durationMs: number
}

/** Tool dispatch was orphaned (process restarted mid-flight). */
export interface ToolDispatchLostEvent extends GovernanceEventBase {
  type: 'tool_dispatch_lost'
  toolCallId: string
  toolName: string
  idempotencyKey: string
}

/** Frozen-snapshot drift — wake aborted to protect prefix-cache integrity. */
export interface FrozenSnapshotViolationEvent extends GovernanceEventBase {
  type: 'frozen_snapshot_violation'
  expectedSystemHash: string
  actualSystemHash: string
  expectedMaterializerSet: readonly string[]
  actualMaterializerSet: readonly string[]
}

// ─── Side-load + materializers ──────────────────────────────────────────────

export type SideLoadKind =
  | 'working_memory'
  | 'pending_approvals'
  | 'delivery_status'
  | 'internal_notes_delta'
  | 'drive_hint'
  | 'custom'

export interface SideLoadItem {
  kind: SideLoadKind
  /** Higher = appears earlier in the zone. */
  priority: number
  render: () => string
}

export interface SideLoadCtx {
  readonly organizationId: string
  readonly conversationId: string
  readonly agentId: string
  readonly contactId: string
  readonly turnIndex: number
}

export type SideLoadContributor = (ctx: SideLoadCtx) => Promise<SideLoadItem[]>

export type MaterializerPhase = 'frozen' | 'side-load' | 'on-read'

export interface MaterializerCtx {
  organizationId: string
  agentId: string
  conversationId: string
  contactId: string
  turnIndex: number
  sinceTs?: Date
}

export interface WorkspaceMaterializer {
  /** Absolute workspace path; supports glob for lazy directory mounts. */
  path: string
  phase: MaterializerPhase
  materialize(ctx: MaterializerCtx): Promise<string> | string
}

/**
 * Wake-time materializer factory. The collector aggregates these across
 * modules; the wake builder calls each factory with a template-specific
 * `WakeContext` (identity + handles + lane-scoped tools/agentsMd) to obtain
 * concrete materializers for the wake. Core stays generic over `TCtx` so
 * template-domain types (FilesService, AuthLookup, AgentDefinition) never
 * leak in here.
 */
export type WorkspaceMaterializerFactory<TCtx = unknown> = (ctx: TCtx) => WorkspaceMaterializer[]

// ─── Budget + classifier + abort ────────────────────────────────────────────

export interface IterationBudget {
  maxTurnsPerWake: number
  softCostCeilingUsd: number
  hardCostCeilingUsd: number
  maxOutputTokens: number
  maxInputTokens: number
}

export type BudgetPhase = 'soft' | 'hard'

export interface BudgetState {
  turnsConsumed: number
  spentUsd: number
}

export type ClassifiedErrorReason = 'context_overflow' | 'payload_too_large' | 'transient' | 'unknown'

interface ClassifiedErrorBase {
  httpStatus?: number
  providerMessage: string
  retryAfterMs?: number
}

export type ClassifiedError =
  | ({ reason: 'context_overflow' } & ClassifiedErrorBase)
  | ({ reason: 'payload_too_large' } & ClassifiedErrorBase)
  | ({ reason: 'transient' } & ClassifiedErrorBase)
  | ({ reason: 'unknown' } & ClassifiedErrorBase)

/** Per-wake abort coordination carrier. */
export interface AbortContext {
  wakeAbort: AbortController
  reason: string | null
}
