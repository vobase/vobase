/**
 * `propose_outreach` — operator queues an outbound message draft for staff
 * review. Same `pending_approvals` queue as `draft_email_to_review`, but the
 * tool name distinguishes intent for the review UI: outreach is a proactive
 * touch (no inbound trigger), email is a response or follow-up that already
 * has a thread.
 *
 * The channel is captured but not validated here — the channel adapter
 * resolves at dispatch-time after staff approval.
 */

import { insert as insertPendingApproval } from '@modules/messaging/service/pending-approvals'
import { type Static, Type } from '@sinclair/typebox'

import { defineAgentTool } from '../shared/define-tool'

export const ProposeOutreachInputSchema = Type.Object({
  contactId: Type.String({ minLength: 1 }),
  channelInstanceId: Type.String({ minLength: 1 }),
  /** Free-form proposed message body. Plain text; channel adapter handles formatting. */
  body: Type.String({ minLength: 1, maxLength: 4000 }),
  /** Why this outreach matters — surfaces in the review UI to help staff decide. */
  reason: Type.Optional(Type.String({ maxLength: 2000 })),
})

export type ProposeOutreachToolInput = Static<typeof ProposeOutreachInputSchema>

export const proposeOutreachTool = defineAgentTool({
  name: 'propose_outreach',
  description:
    'Queue a proactive outreach message for staff approval. Lands in pending_approvals; nothing sends until approved. Operator-only.',
  schema: ProposeOutreachInputSchema,
  errorCode: 'APPROVAL_ERROR',
  async run(args, ctx) {
    const row = await insertPendingApproval({
      organizationId: ctx.organizationId,
      // Outreach has no conversation yet — `pending_approvals.conversationId`
      // is nullable for this case; the review UI runs create-or-resume on
      // approval. The `toolName = 'propose_outreach'` discriminator is the
      // canonical "no conversation" signal.
      conversationId: null,
      conversationEventId: null,
      toolName: 'propose_outreach',
      toolArgs: args,
      agentSnapshot: { agentId: ctx.agentId, wakeId: ctx.wakeId, turnIndex: ctx.turnIndex },
    })
    return { approvalId: row.id }
  },
})
