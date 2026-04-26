/**
 * `add_note` — operator-side internal-note write. The note is attributed to
 * the operator agent via `ctx.agentId` and timestamped server-side. Operator
 * agents use this to leave breadcrumbs on customer conversations after
 * triage, refund analysis, or a heartbeat sweep.
 */

import { addNote } from '@modules/messaging/service/notes'
import { type Static, Type } from '@sinclair/typebox'
import { Value } from '@sinclair/typebox/value'
import type { AgentTool, ToolContext, ToolResult } from '@vobase/core'

export const AddNoteInputSchema = Type.Object({
  conversationId: Type.String({
    minLength: 1,
    description: 'Conversation id the note attaches to.',
  }),
  body: Type.String({ minLength: 1, maxLength: 4000 }),
  mentions: Type.Optional(Type.Array(Type.String({ minLength: 1 }))),
})

export type AddNoteToolInput = Static<typeof AddNoteInputSchema>

export const addNoteTool: AgentTool<AddNoteToolInput, { noteId: string }> = {
  name: 'add_note',
  description:
    'Append an internal note to a conversation timeline. Author is the operator agent. Returns the new note id. Operator-only.',
  inputSchema: AddNoteInputSchema,
  parallelGroup: 'never',

  async execute(args, ctx: ToolContext): Promise<ToolResult<{ noteId: string }>> {
    if (!Value.Check(AddNoteInputSchema, args)) {
      const first = Value.Errors(AddNoteInputSchema, args).First()
      return {
        ok: false,
        error: `Invalid add_note input — ${first ? `${first.path || 'root'}: ${first.message}` : 'unknown'}`,
        errorCode: 'VALIDATION_ERROR',
      }
    }
    try {
      const row = await addNote({
        organizationId: ctx.organizationId,
        conversationId: args.conversationId,
        author: { kind: 'agent', id: ctx.agentId },
        body: args.body,
        mentions: args.mentions ?? [],
      })
      return { ok: true, content: { noteId: row.id } }
    } catch (err) {
      return {
        ok: false,
        error: err instanceof Error ? err.message : 'add_note failed',
        errorCode: 'NOTES_ERROR',
      }
    }
  },
}
