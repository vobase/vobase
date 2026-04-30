/**
 * `add_note` — internal-note write to a conversation timeline. The note is
 * attributed to the agent via `ctx.agentId` and timestamped server-side.
 * Wired into both lanes:
 *   - Standalone (operator/heartbeat): leave breadcrumbs after triage, refund
 *     analysis, or a sweep.
 *   - Conversation (inbound/supervisor/approval-resumed): acknowledge a staff
 *     coaching note, summarise what was captured to MEMORY.md, or record a
 *     decision the agent made on the thread. Survives the coaching tool
 *     filter because it has no `audience: 'customer'` tag.
 *
 * Ping-pong is gated in `messaging/service/notes.ts` — agent-authored notes
 * never trigger supervisor fan-out, so this tool cannot recursively wake the
 * caller.
 */

import { type Static, Type } from '@sinclair/typebox'
import { defineAgentTool } from '@vobase/core'

import { addNote } from '../service/notes'

export const AddNoteInputSchema = Type.Object({
  conversationId: Type.String({
    minLength: 1,
    description: 'Conversation id the note attaches to.',
  }),
  body: Type.String({ minLength: 1, maxLength: 4000 }),
  mentions: Type.Optional(Type.Array(Type.String({ minLength: 1 }))),
})

export type AddNoteToolInput = Static<typeof AddNoteInputSchema>

export const addNoteTool = defineAgentTool({
  name: 'add_note',
  description:
    'Append an internal note to a conversation timeline. Author is the operator agent. Returns the new note id. Operator-only.',
  schema: AddNoteInputSchema,
  errorCode: 'NOTES_ERROR',
  lane: 'both',
  prompt:
    'Leave breadcrumbs on a customer conversation timeline after triage, refund analysis, or a heartbeat sweep. Visible to staff in the conversation view; not visible to the customer.',
  async run(args, ctx) {
    const row = await addNote({
      organizationId: ctx.organizationId,
      conversationId: args.conversationId,
      author: { kind: 'agent', id: ctx.agentId },
      body: args.body,
      mentions: args.mentions ?? [],
    })
    return { noteId: row.id }
  },
})
