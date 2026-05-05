/**
 * `vobase conv reassign` — hand a conversation off to a different assignee.
 *
 * Migrated from the agent-bash `CommandDef` of the same name. Now a unified
 * `defineCliVerb` so the agent's bash sandbox AND a human running `vobase` from
 * the binary share one body. The verb is conversation-scoped: the in-process
 * transport injects `ctx.wake.conversationId` from the wake; HTTP-RPC callers
 * pass `--conversationId=<id>` as input.
 */

import { hasRecentAgentReply } from '@modules/messaging/service/messages'
import { list as listStaff } from '@modules/team/service/staff'
import { defineCliVerb } from '@vobase/core'
import { z } from 'zod'

import { reassign as reassignConversation } from '../service/conversations'

const AssigneeSchema = z
  .string()
  .refine(
    (v) => v === 'unassigned' || /^user:[^\s]+$/.test(v) || /^agent:[^\s]+$/.test(v),
    '--to must be "user:<id>", "agent:<id>", or "unassigned"',
  )

export const convReassignVerb = defineCliVerb({
  name: 'conv reassign',
  description:
    'Hand the conversation off to a different assignee. user:<id> escalates to a human; the agent stops replying until reassigned back. The customer continues to wait on whatever they last asked, so a human-handoff WITHOUT a customer-facing acknowledgment first is a UX bug.',
  usage: 'vobase conv reassign --to=<user:<id>|agent:<id>|unassigned> [--reason="..."] [--conversationId=<id>]',
  audience: 'contact',
  prompt: `HANDOFF PLAYBOOK — call these tools in this order, never skip step 1:
  1. send_card or reply  — tell the customer you're handing off, who you're routing to, and roughly what to expect ("Alice handles SOC2 docs, she'll be in touch shortly"). Customer-facing acknowledgment is mandatory.
  2. add_note            — leave context for the assignee with \`mentions\` populated (the @-mention drives their notification).
  3. vobase conv reassign --to=user:<id> [--reason="..."] — actually flip the assignee.
Use the verb for explicit human-handoff requests, legal/compliance, or large refunds. Run \`vobase team list\` first to look up real userIds — never invent them.`,
  input: z.object({
    to: AssigneeSchema,
    reason: z.string().optional(),
    /** Required for HTTP-RPC; the in-process transport defaults to ctx.wake.conversationId. */
    conversationId: z.string().optional(),
  }),
  body: async ({ input, ctx }) => {
    const conversationId = input.conversationId ?? ctx.wake?.conversationId
    if (!conversationId) {
      return {
        ok: false as const,
        error: '--conversationId is required (or invoke from within a wake)',
        errorCode: 'invalid_input',
      }
    }

    let assignee: string
    if (input.to === 'unassigned') {
      assignee = 'unassigned'
    } else if (input.to.startsWith('agent:')) {
      assignee = input.to
    } else {
      // user:<id> — resolve against the staff roster so we reject typos before
      // committing the reassign (the wake-handler skips non-agent assignees).
      const rawId = input.to.slice('user:'.length)
      const staff = await listStaff(ctx.organizationId)
      const hit =
        staff.find((s) => s.userId === rawId) ?? staff.find((s) => s.displayName?.toLowerCase() === rawId.toLowerCase())
      if (!hit) {
        const roster =
          staff.length === 0
            ? '(no staff on this organization)'
            : staff.map((s) => `  user:${s.userId} — ${s.displayName ?? '(unnamed)'}`).join('\n')
        return {
          ok: false as const,
          error: `unknown staff: ${rawId}. Valid staff:\n${roster}\nUse a userId or displayName from \`vobase team list\`.`,
          errorCode: 'invalid_input',
        }
      }
      assignee = `user:${hit.userId}`
    }

    // Customer-ack precondition: agent → human handoffs require a customer-facing
    // reply within this wake. The 60-second window is generous enough to cover any
    // realistic wake duration without needing to thread wakeId through.
    if (assignee.startsWith('user:') && ctx.principal.kind === 'agent') {
      const acked = await hasRecentAgentReply(conversationId, 60)
      if (!acked) {
        return {
          ok: false as const,
          error:
            "Refusing to reassign: the customer hasn't been told they're being handed off. Call `reply` or `send_card` FIRST to acknowledge the handoff (mention who you're routing to and what to expect), THEN re-run this verb. See the handoff playbook in the verb prompt.",
          errorCode: 'no_customer_ack',
        }
      }
    }

    const actor = ctx.principal.kind === 'agent' ? `agent:${ctx.principal.id}` : `user:${ctx.principal.id}`
    const conv = await reassignConversation(conversationId, assignee, actor, input.reason)
    return {
      ok: true as const,
      data: { id: conv.id, assignee: conv.assignee, reason: input.reason ?? null },
      summary: `Reassigned conversation ${conv.id} → ${conv.assignee}${input.reason ? ` (reason: ${input.reason})` : ''}`,
    }
  },
  formatHint: 'json',
})
