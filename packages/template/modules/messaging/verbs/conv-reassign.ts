/**
 * `vobase conv reassign` — hand a conversation off to a different assignee.
 *
 * Migrated from the agent-bash `CommandDef` of the same name. Now a unified
 * `defineCliVerb` so the agent's bash sandbox AND a human running `vobase` from
 * the binary share one body. The verb is conversation-scoped: the in-process
 * transport injects `ctx.wake.conversationId` from the wake; HTTP-RPC callers
 * pass `--conversationId=<id>` as input.
 */

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
    'Hand the conversation off to a different assignee. user:<id> escalates to a human; the agent stops replying until reassigned back.',
  usage: 'vobase conv reassign --to=<user:<id>|agent:<id>|unassigned> [--reason="..."] [--conversationId=<id>]',
  prompt:
    'Use for explicit human-handoff requests, legal/compliance, or large refunds. Do NOT invent userIds — run `vobase team list` first to look up real ones.',
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
