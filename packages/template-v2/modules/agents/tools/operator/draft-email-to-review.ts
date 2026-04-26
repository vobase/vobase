/**
 * `draft_email_to_review` — operator queues an email draft into the
 * `pending_approvals` table for staff review before it ships. The actual
 * outbound dispatch happens elsewhere (a staff member approves the row, then
 * the messaging side picks it up and routes to the email channel).
 *
 * The tool name + args are stored verbatim in `pendingApprovals.toolArgs`,
 * which is the staff review UI's source of truth for what the agent is
 * proposing. Author identity comes from `ctx.agentId` via `agentSnapshot`.
 */

import { insert as insertPendingApproval } from '@modules/messaging/service/pending-approvals'
import { type Static, Type } from '@sinclair/typebox'
import { Value } from '@sinclair/typebox/value'
import type { AgentTool, ToolContext, ToolResult } from '@vobase/core'

export const DraftEmailInputSchema = Type.Object({
  conversationId: Type.String({ minLength: 1 }),
  subject: Type.String({ minLength: 1, maxLength: 200 }),
  body: Type.String({ minLength: 1, maxLength: 20000 }),
  /** Optional thread-recipient hint (e.g. customer's email). Stored as-is in `toolArgs`. */
  to: Type.Optional(Type.String({ minLength: 1, maxLength: 320 })),
})

export type DraftEmailToolInput = Static<typeof DraftEmailInputSchema>

export const draftEmailToReviewTool: AgentTool<DraftEmailToolInput, { approvalId: string }> = {
  name: 'draft_email_to_review',
  description:
    'Queue an outbound email draft for staff approval. Lands in pending_approvals; nothing is sent until approved. Operator-only.',
  inputSchema: DraftEmailInputSchema,
  parallelGroup: 'never',

  async execute(args, ctx: ToolContext): Promise<ToolResult<{ approvalId: string }>> {
    if (!Value.Check(DraftEmailInputSchema, args)) {
      const first = Value.Errors(DraftEmailInputSchema, args).First()
      return {
        ok: false,
        error: `Invalid draft_email_to_review input — ${first ? `${first.path || 'root'}: ${first.message}` : 'unknown'}`,
        errorCode: 'VALIDATION_ERROR',
      }
    }
    try {
      const row = await insertPendingApproval({
        organizationId: ctx.organizationId,
        conversationId: args.conversationId,
        conversationEventId: null,
        toolName: 'draft_email_to_review',
        toolArgs: args,
        agentSnapshot: { agentId: ctx.agentId, wakeId: ctx.wakeId, turnIndex: ctx.turnIndex },
      })
      return { ok: true, content: { approvalId: row.id } }
    } catch (err) {
      return {
        ok: false,
        error: err instanceof Error ? err.message : 'draft_email_to_review failed',
        errorCode: 'APPROVAL_ERROR',
      }
    }
  },
}
