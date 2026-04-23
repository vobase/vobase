/**
 * Typed AgentTool envelope + ToolContext.
 *
 * `AgentTool<TArgs, TResult>` is the full generic form used by tool implementors
 * (see `modules/messaging/tools/` and `modules/agents/tools/`).
 *
 * `ToolContext.approvalDecision` is the approval decision carrier — the
 * harness populates it on wakes triggered by `approval_resumed` so the tool body
 * can read the staff decision without querying the DB.
 */

import type { ToolResult } from './tool-result'

// ─── Tool execution context ─────────────────────────────────────────────────

export interface ToolContext {
  organizationId: string
  conversationId: string
  wakeId: string
  agentId: string
  turnIndex: number
  toolCallId: string

  /**
   * Approval decision carrier — populated when the wake trigger is `approval_resumed`.
   * Undefined for the initial (unapproved) tool call — the mutator gate will block
   * and insert a `pending_approvals` row before execution reaches the tool body.
   */
  approvalDecision?: {
    decision: 'approved' | 'rejected'
    note?: string
    decidedByUserId?: string
  }
}

// ─── Tool definition ────────────────────────────────────────────────────────

export interface AgentTool<TArgs = unknown, TResult = unknown> {
  name: string
  description: string
  /**
   * Zod or TypeBox schema — harness adapts at runtime.
   * Typed as `unknown` here so the contracts layer stays agnostic of the schema library.
   */
  inputSchema: unknown
  outputSchema?: unknown

  /**
   * When true, the approval mutator will intercept at `tool_execution_start`
   * and block execution pending staff decision. Tool body is NOT called until the
   * approval_resumed wake injects the decision via `ctx.approvalDecision`.
   */
  requiresApproval?: boolean

  /**
   * Parallel execution safety classification (metadata only — scheduler not yet wired).
   * `'never'`     → must run serially; never batched with another tool call.
   * `'safe'`      → side-effect-free; can run concurrently with any other safe call.
   * `path-scoped` → can run concurrently with other path-scoped calls whose paths do
   *                 not overlap (checked by `pathsOverlap()`). `pathArg` names the
   *                 input field that carries the target path.
   * Omitting this field is equivalent to `'never'` (conservative default).
   */
  parallelGroup?: 'never' | 'safe' | { kind: 'path-scoped'; pathArg: string }

  execute(args: TArgs, ctx: ToolContext): Promise<ToolResult<TResult>>
}
