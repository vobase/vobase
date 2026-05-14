/**
 * `add_note` — undirected breadcrumb on a conversation timeline. The note is
 * attributed to the agent via `ctx.agentId` and timestamped server-side.
 *
 * No recipient, no notification — this is purely a timeline annotation:
 * leave a record of what was triaged, decided, or observed. To address a
 * staff colleague (ask a question, flag something, get a decision), use
 * `consult_staff` — it carries `mentions` and wakes the agent back on a reply.
 *
 * Wired into both lanes:
 *   - Standalone (operator/heartbeat): leave breadcrumbs after triage, refund
 *     analysis, or a sweep.
 *   - Conversation (inbound/staff_note/approval-resumed): record a decision
 *     the agent made on the thread, or summarise what was captured to memory.
 */

import { type Static, Type } from '@sinclair/typebox'
import { defineAgentTool } from '@vobase/core'

import { addNote } from '../service/notes'

export const AddNoteInputSchema = Type.Object({
  conversationId: Type.Optional(
    Type.String({
      minLength: 1,
      description:
        'Conversation id the note attaches to. Optional — defaults to the current wake conversation. Required only on standalone-lane wakes (heartbeat / operator-thread) where you need to leave a breadcrumb on a different conversation.',
    }),
  ),
  body: Type.String({ minLength: 1, maxLength: 4000 }),
})

export type AddNoteToolInput = Static<typeof AddNoteInputSchema>

export const addNoteTool = defineAgentTool({
  name: 'add_note',
  description:
    'Append an undirected breadcrumb to a conversation timeline — visible to staff, not the customer. No recipient, no notification. To address a staff colleague, use `consult_staff` instead.',
  schema: AddNoteInputSchema,
  errorCode: 'NOTES_ERROR',
  lane: 'both',
  prompt:
    'Leave a breadcrumb on the timeline — what you triaged, decided, or observed — after a refund analysis, a heartbeat sweep, or a decision you made on the thread. Visible to staff, not the customer. This note has no recipient and notifies nobody: to ask a staff colleague a question or get a decision, use `consult_staff`, which addresses people and wakes you back on their reply. Omit `conversationId` on conversation-lane wakes — it defaults to the current wake conversation. Pass it explicitly only on standalone-lane wakes (heartbeat / operator-thread) when noting on a different conversation.',
  async run(args, ctx) {
    const conversationId = args.conversationId ?? ctx.conversationId
    if (!conversationId) {
      throw new Error('add_note: no conversationId — pass one in args or call from a wake bound to a conversation.')
    }
    const row = await addNote({
      organizationId: ctx.organizationId,
      conversationId,
      author: { kind: 'agent', id: ctx.agentId },
      body: args.body,
    })
    return { noteId: row.id }
  },
})
