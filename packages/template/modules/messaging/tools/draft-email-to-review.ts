/**
 * `draft_email_to_review` — operator queues an email draft into the
 * `pending_approvals` table for staff review before it ships. The actual
 * outbound dispatch happens elsewhere (a staff member approves the row, then
 * the messaging side picks it up and routes to the email channel).
 *
 * The tool name + args are stored verbatim in `pendingApprovals.toolArgs`,
 * which is the staff review UI's source of truth for what the agent is
 * proposing. Author identity comes from `ctx.agentId` via `agentSnapshot`.
 *
 * US-008 (Slice B.3): insert + `emit('approval_filed', …)` are wrapped in a
 * single `db.transaction(...)` here at the tool boundary (NOT inside
 * `pending-approvals.ts::insert`). The emit lives here because `ctx.agentId`
 * — the routing target for the standalone wake the dispatcher fires in
 * Slice B.4 — is only in scope at the tool layer.
 */

import { emit } from '@modules/automations/service/events'
import { type Static, Type } from '@sinclair/typebox'
import { defineAgentTool } from '@vobase/core'

import type { Tx } from '~/runtime'
import { getPendingApprovalsTxDb, insert as insertPendingApproval } from '../service/pending-approvals'

export const DraftEmailInputSchema = Type.Object({
  conversationId: Type.String({ minLength: 1 }),
  subject: Type.String({ minLength: 1, maxLength: 200 }),
  body: Type.String({ minLength: 1, maxLength: 20000 }),
  /** Optional thread-recipient hint (e.g. customer's email). Stored as-is in `toolArgs`. */
  to: Type.Optional(Type.String({ minLength: 1, maxLength: 320 })),
})

export type DraftEmailToolInput = Static<typeof DraftEmailInputSchema>

export const draftEmailToReviewTool = defineAgentTool({
  name: 'draft_email_to_review',
  description:
    'Queue an outbound email draft for staff approval. Lands in pending_approvals; nothing is sent until approved. Operator-only.',
  schema: DraftEmailInputSchema,
  errorCode: 'APPROVAL_ERROR',
  lane: 'standalone',
  prompt:
    'Use when responding-by-email or following up on an existing thread. Nothing dispatches until staff approves the row. Pair with `propose_outreach` for proactive (no-thread) touches.',
  async run(args, ctx) {
    const txDb = getPendingApprovalsTxDb()
    const result = await txDb.transaction(async (tx) => {
      const row = await insertPendingApproval(
        {
          organizationId: ctx.organizationId,
          conversationId: args.conversationId,
          conversationEventId: null,
          toolName: 'draft_email_to_review',
          toolArgs: args,
          agentSnapshot: { agentId: ctx.agentId, wakeId: ctx.wakeId, turnIndex: ctx.turnIndex },
        },
        tx as Tx,
      )
      const approvalSummary = `${args.subject} (${args.body.slice(0, 80)}${args.body.length > 80 ? '…' : ''})`
      await emit(
        'approval_filed',
        {
          conversationId: args.conversationId,
          organizationId: ctx.organizationId,
          approvalId: row.id,
          approvalSummary,
          filedByAgentId: ctx.agentId,
          assigneeStaffUserId: null,
        },
        { tx: tx as Tx },
      )
      return { approvalId: row.id }
    })
    return result
  },
})
