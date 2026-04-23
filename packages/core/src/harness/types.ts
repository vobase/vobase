/**
 * Generic harness + workspace contracts.
 *
 * Concrete `AgentEvent` unions (with domain event variants) are owned by each
 * app; core ships only the primitives every harness consumer needs: tool
 * envelope, tool context, tool result, side-load/materializer shapes, budget +
 * classifier + abort carriers, plus the `tool_result_persisted` event shape
 * (emitted by the spill logic via a callback).
 */

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
  /** Absolute path inside /workspace/tmp/ where the full result was spilled. */
  path: string
  originalByteLength: number
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

// ─── Vobase CLI command definitions ─────────────────────────────────────────

export interface CommandContext {
  organizationId: string
  conversationId: string
  agentId: string
  contactId: string
  /** Raw write to the virtual workspace. Used by `vobase memory set` etc. */
  writeWorkspace: (path: string, content: string) => Promise<void>
  readWorkspace: (path: string) => Promise<string>
}

export interface CommandDef {
  name: string
  description: string
  usage?: string
  /** Called by the `vobase` CLI dispatcher in just-bash. */
  execute: (argv: readonly string[], ctx: CommandContext) => Promise<ToolResult<string>>
}
