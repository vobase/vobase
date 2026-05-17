/**
 * `consult_staff` — directed agent→staff message on a conversation.
 *
 * The agent's first-class way to talk to its staff colleagues: ask a
 * question, flag something, or get a decision. Each addressed staff member is
 * notified; their reply fires a staff-note wake so the agent resumes with the
 * answer. Distinct from `add_note`, which is an undirected breadcrumb with no
 * recipient and no notification.
 *
 * Backed by the same `internal_notes` write path as `add_note` — `consult_staff`
 * always carries resolved `mentions`, `add_note` never does. Agent-authored
 * notes never trigger staff-note fan-out for the agent itself; staff become
 * aware via the staff-ping path (enqueued here as a durable job), and their
 * reply is what wakes the agent back. The HTTP notes handler enqueues the
 * same fan-out for human-authored notes — this is its agent-write-path twin.
 */

import { enqueueMentionFanOut } from '@modules/team/service/staff-ping'
import { type Static, Type } from '@sinclair/typebox'
import { defineAgentTool, logger } from '@vobase/core'

import { addNote } from '../service/notes'
import { prependMentionTags, resolveStaffMentions } from './lib/resolve-staff-mentions'

export const ConsultStaffInputSchema = Type.Object({
  to: Type.Array(Type.String({ minLength: 1, maxLength: 64 }), {
    minItems: 1,
    maxItems: 16,
    description:
      'Staff to address — userIds or display names (run `vobase team list` if unsure). Each is notified; their reply wakes you back.',
  }),
  body: Type.String({ minLength: 1, maxLength: 4000, description: 'Your message to staff.' }),
  conversationId: Type.Optional(
    Type.String({
      minLength: 1,
      description:
        'Conversation to attach to. Defaults to the current wake conversation; pass explicitly only on standalone wakes when addressing a different conversation.',
    }),
  ),
})

export type ConsultStaffInput = Static<typeof ConsultStaffInputSchema>

export const consultStaffTool = defineAgentTool({
  name: 'consult_staff',
  description:
    'Send a message to staff colleagues about this conversation. They are notified, and their reply wakes you back so you can act on the answer.',
  schema: ConsultStaffInputSchema,
  errorCode: 'CONSULT_STAFF_ERROR',
  lane: 'both',
  prompt:
    "Message your staff colleagues about this conversation — to ask a question, flag something, or get a decision. Address one or more people in `to` (userIds or display names; run `vobase team list` if unsure). They are notified and their reply wakes you back, so the customer can wait on a real answer instead of a guess. Reach for this whenever the customer's request needs a judgment call, a policy exception, missing information, or anything you cannot ground in the workspace — consulting staff before replying is the norm for non-trivial cases, not a last resort. For an undirected breadcrumb with no recipient, use `add_note` instead. Omit `conversationId` on conversation wakes; pass it only on standalone wakes when addressing a different conversation.",
  async run(args, ctx) {
    const conversationId = args.conversationId ?? ctx.conversationId
    if (!conversationId) {
      throw new Error(
        'consult_staff: no conversationId — pass one in args or call from a wake bound to a conversation.',
      )
    }
    const { mentions, names } = await resolveStaffMentions(ctx.organizationId, args.to)
    const body = prependMentionTags(args.body, names)
    const row = await addNote({
      organizationId: ctx.organizationId,
      conversationId,
      author: { kind: 'agent', id: ctx.agentId },
      body,
      mentions,
    })
    // Durably enqueue the mention fan-out (offline → WhatsApp ping + the
    // pending-mention-ping ledger row that wakes this agent on a reply) as a
    // pg-boss job, so it survives a process recycle. Best-effort: a failed
    // enqueue — including the "service not installed" throw in unit-test
    // contexts — must not fail the note write.
    try {
      await enqueueMentionFanOut(row)
    } catch (err) {
      logger.error({ err }, '[messaging/consult_staff] mention fan-out enqueue failed (non-fatal)')
    }
    return { noteId: row.id, notified: mentions }
  },
})
