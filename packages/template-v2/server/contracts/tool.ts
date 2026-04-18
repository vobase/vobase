/**
 * Typed AgentTool envelope + ToolContext — plan §P2.0, §P2.2.
 *
 * `AgentTool<TArgs, TResult>` is the full generic form used by tool implementors
 * (see `modules/inbox/tools/` and `modules/agents/tools/`). The narrower stub in
 * `plugin-context.ts` is kept for PluginContext.registerTool() backward compat and
 * will be unified here in Phase 3.
 *
 * P2.2 note: `ToolContext.approvalDecision` is the approval decision carrier — the
 * harness populates it on wakes triggered by `approval_resumed` so the tool body
 * can read the staff decision without querying the DB.
 */

import type { ToolResult } from './tool-result'

// ─── Tool execution context ─────────────────────────────────────────────────

export interface ToolContext {
  tenantId: string
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
   * When true, the approval mutator (P2.2) will intercept at `tool_execution_start`
   * and block execution pending staff decision. Tool body is NOT called until the
   * approval_resumed wake injects the decision via `ctx.approvalDecision`.
   */
  requiresApproval?: boolean

  execute(args: TArgs, ctx: ToolContext): Promise<ToolResult<TResult>>
}
