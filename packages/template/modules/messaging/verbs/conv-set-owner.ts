/**
 * `vobase conv set-owner` — set the staff member in charge of a conversation.
 *
 * The "owner" is distinct from the assignee. `assignee` is the responder (which
 * agent or human replies); `ownerUserId` is who owns the lead/ticket. Setting an
 * owner does NOT silence the agent — it keeps replying. Used by staff to hand a
 * ticket to a colleague, and (later) by the `route_lead` tool to record the
 * routed rep. Conversation-scoped: the in-process transport injects
 * `ctx.wake.conversationId`; HTTP-RPC callers pass `--conversationId=<id>`.
 */

import { resolveStaffRef } from '@modules/team/service/staff'
import { defineCliVerb } from '@vobase/core'
import { z } from 'zod'

import { setOwner as setConversationOwner } from '../service/conversations'

const OwnerSchema = z
  .string()
  .refine(
    (v) => v === 'unassigned' || v === 'none' || /^user:[^\s]+$/.test(v),
    '--to must be "user:<id>" or "unassigned"',
  )

export const convSetOwnerVerb = defineCliVerb({
  name: 'conv set-owner',
  description:
    'Set the staff member in charge of this conversation (the owner). Distinct from the assignee — the agent keeps replying. Pass "unassigned" to clear.',
  usage: 'vobase conv set-owner --to=<user:<id>|unassigned> [--conversationId=<id>]',
  audience: 'staff',
  prompt:
    'Set the staff member who owns this lead/ticket. This does NOT change who replies — the agent keeps handling the conversation. Once an owner is set, address them by default with `consult_staff` when you need staff help. Run `vobase team list` first for real userIds.',
  input: z.object({
    to: OwnerSchema,
    /** Honored only for out-of-wake HTTP-RPC; inside a wake, ctx.wake.conversationId is authoritative and this is ignored. */
    conversationId: z.string().optional(),
  }),
  body: async ({ input, ctx }) => {
    // Inside a wake the conversation is fixed by the harness; an in-wake agent must
    // not be able to set the owner on a different conversation by passing a stray
    // --conversationId. The flag is only honored out-of-wake (HTTP-RPC, ctx.wake undefined).
    const conversationId = ctx.wake?.conversationId ?? input.conversationId
    if (!conversationId) {
      return {
        ok: false as const,
        error: '--conversationId is required (or invoke from within a wake)',
        errorCode: 'invalid_input',
      }
    }

    let ownerUserId: string | null
    if (input.to === 'unassigned' || input.to === 'none') {
      ownerUserId = null
    } else {
      // user:<id> — resolve against the staff roster so typos are rejected up front.
      try {
        ownerUserId = (await resolveStaffRef(ctx.organizationId, input.to)).userId
      } catch (err) {
        return {
          ok: false as const,
          error: err instanceof Error ? err.message : String(err),
          errorCode: 'invalid_input',
        }
      }
    }

    const actor = ctx.principal.kind === 'agent' ? `agent:${ctx.principal.id}` : `user:${ctx.principal.id}`
    const conv = await setConversationOwner(conversationId, ownerUserId, actor)
    return {
      ok: true as const,
      data: { id: conv.id, ownerUserId: conv.ownerUserId },
      summary: conv.ownerUserId
        ? `Set owner of conversation ${conv.id} → user:${conv.ownerUserId}`
        : `Cleared owner of conversation ${conv.id}`,
    }
  },
  formatHint: 'json',
})
