/**
 * `route_lead` — assign a qualified inquiry to the staff member in charge.
 *
 * Deterministic: the agent supplies the inquiry type (and, for corporate, the
 * company / industry it has gathered) and the routing service picks the owner
 * from `routing_rules` + the better-auth teams. The tool then:
 *   1. sets `conversations.owner_user_id` (the staff-in-charge) — `assignee` is
 *      NEVER touched, so the agent keeps replying to the customer;
 *   2. drops an `@`-mention note so the routed rep is pinged and the owner
 *      block appears in the agent's context on the next wake.
 *
 * Idempotent: a conversation that already has an owner is left alone unless
 * `correction: true` is passed (the agent learned it routed the wrong way).
 */

import { get as getConversation, lastOwnerAssignedAt, setOwner } from '@modules/messaging/service/conversations'
import { addNote } from '@modules/messaging/service/notes'
import { prependMentionTags } from '@modules/messaging/tools/lib/resolve-staff-mentions'
import { type Static, Type } from '@sinclair/typebox'
import { defineAgentTool, logger } from '@vobase/core'

import { routeLead } from '../service/lead-routing'
import { find as findStaff } from '../service/staff'
import { enqueueMentionFanOut } from '../service/staff-ping'

export const RouteLeadInputSchema = Type.Object({
  inquiryType: Type.Union([Type.Literal('corporate'), Type.Literal('private')], {
    description:
      'corporate = a company / organisation event; private = an individual / family ordering for themselves.',
  }),
  companyName: Type.Optional(
    Type.String({ maxLength: 200, description: 'Company or organisation name — corporate inquiries only.' }),
  ),
  industry: Type.Optional(
    Type.String({
      maxLength: 200,
      description: 'Industry / sector if known (e.g. "bank", "university", "hotel") — sharpens corporate routing.',
    }),
  ),
  correction: Type.Optional(
    Type.Boolean({
      description: 'Set true to re-route a conversation that already has an owner (you routed it wrong before).',
    }),
  ),
})

export type RouteLeadInput = Static<typeof RouteLeadInputSchema>

export const routeLeadTool = defineAgentTool({
  name: 'route_lead',
  description:
    'Assign this conversation to the staff member in charge once you know whether it is a corporate or private inquiry. Sets the owner; you keep replying to the customer.',
  schema: RouteLeadInputSchema,
  errorCode: 'ROUTE_LEAD_ERROR',
  lane: 'conversation',
  prompt:
    'Call once the inquiry is qualified enough to assign an owner — you know it is corporate vs private, and for corporate you have the company name or industry. Routing is deterministic (keyword rules + round-robin), so do NOT ask the customer "which sector are you" — pass what you already have. This sets the staff owner only; `assignee` is untouched so you keep handling the conversation. It is idempotent — calling it again on an already-owned conversation is a safe no-op; pass `correction: true` only to deliberately re-route.',
  async run(args, ctx) {
    const conversationId = ctx.conversationId
    if (!conversationId) {
      throw new Error('route_lead: no conversationId — call from a conversation wake.')
    }

    // Idempotency — leave an already-owned conversation alone unless correcting.
    const conv = await getConversation(conversationId).catch(() => null)
    if (conv?.ownerUserId && !args.correction) {
      return {
        routed: false as const,
        idempotentHit: true as const,
        ownerUserId: conv.ownerUserId,
        reason: 'Conversation already has an owner — pass correction: true to re-route.',
      }
    }

    const decision = await routeLead({
      organizationId: ctx.organizationId,
      inquiryType: args.inquiryType,
      companyName: args.companyName,
      industry: args.industry,
      lastOwnerAssignedAt: (userIds) => lastOwnerAssignedAt(ctx.organizationId, userIds),
    })

    if (!decision.ownerUserId) {
      // Nothing resolved — surface the reason so the agent falls back to
      // `consult_staff` instead of silently dropping the lead.
      return {
        routed: false as const,
        idempotentHit: false as const,
        ownerUserId: null,
        reason: decision.reason,
      }
    }

    const owner = await findStaff(decision.ownerUserId).catch(() => null)
    const ownerName = owner?.displayName ?? decision.ownerUserId

    await setOwner(conversationId, decision.ownerUserId, `agent:${ctx.agentId}`)

    // Ping the routed rep with an @-mention note. Best-effort — a failed note
    // or fan-out must not undo the owner assignment.
    try {
      const body = prependMentionTags(
        `Routed this lead to you — ${decision.reason}. You are the staff-in-charge; I will keep replying to the customer and consult you when I need help.`,
        [ownerName],
      )
      const note = await addNote({
        organizationId: ctx.organizationId,
        conversationId,
        author: { kind: 'agent', id: ctx.agentId },
        body,
        mentions: [`staff:${decision.ownerUserId}`],
      })
      await enqueueMentionFanOut(note)
    } catch (err) {
      logger.error({ err }, '[team/route_lead] owner-ping note failed (non-fatal)')
    }

    return {
      routed: true as const,
      idempotentHit: false as const,
      ownerUserId: decision.ownerUserId,
      ownerName,
      matchKind: decision.matchKind,
      reason: decision.reason,
    }
  },
})
