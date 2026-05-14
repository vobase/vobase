/**
 * `vobase messaging {list,show,messages,notes,reply,close}` verb registrations.
 * Verbs route through the messaging module's service layer to honor the
 * one-write-path rule.
 */

import { defineCliVerb } from '@vobase/core'
import { z } from 'zod'

import * as conversationsSvc from './service/conversations'
import { list as listMessagesSvc } from './service/messages'
import { listNotes } from './service/notes'
import { sendStaffReply } from './service/staff-reply'
import { summarizeMessageContent } from './service/summarize-content'

// Standalone notes-only markdown view for the `messaging notes` CLI verb. The
// agent itself sees these notes interleaved into CONVERSATION.md (see
// `noteEntry` in ./agent.ts); this is the separate operator-facing rendering.
function renderInternalNotesMd(
  notes: ReadonlyArray<{ authorType: string; authorId: string; createdAt: Date; mentions: string[]; body: string }>,
): string {
  if (notes.length === 0) return '# Internal Notes\n\n_No notes yet._\n'
  const lines = ['# Internal Notes', '']
  for (const n of notes) {
    const mentions = n.mentions.length > 0 ? ` (@${n.mentions.join(' @')})` : ''
    lines.push(`**${n.authorType}:${n.authorId}** (${new Date(n.createdAt).toISOString()})${mentions}:`)
    lines.push(n.body, '')
  }
  return lines.join('\n')
}

const ListTabSchema = z.enum(['active', 'later', 'done']).optional()

export const messagingListVerb = defineCliVerb({
  name: 'messaging list',
  description: 'List customer conversations in this organization.',
  audience: 'admin',
  input: z.object({
    tab: ListTabSchema,
    owner: z.string().optional(),
    contactId: z.string().optional(),
    limit: z.number().int().positive().max(200).default(50),
  }),
  body: async ({ input, ctx }) => {
    const rows = await conversationsSvc.list(ctx.organizationId, {
      tab: input.tab,
      owner: input.owner,
      contactId: input.contactId,
    })
    return {
      ok: true as const,
      data: rows.slice(0, input.limit).map((c) => ({
        id: c.id,
        contactId: c.contactId,
        status: c.status,
        assignee: c.assignee,
        snoozedUntil: c.snoozedUntil,
        lastMessageAt: c.lastMessageAt,
        createdAt: c.createdAt,
      })),
    }
  },
  formatHint: 'table:cols=id,contactId,status,assignee,snoozedUntil,lastMessageAt',
})

export const messagingShowVerb = defineCliVerb({
  name: 'messaging show',
  description: 'Show a conversation summary + recent activity.',
  audience: 'staff',
  input: z.object({ id: z.string().min(1) }),
  body: async ({ input, ctx }) => {
    try {
      const [conversation, activity] = await Promise.all([
        conversationsSvc.get(input.id),
        conversationsSvc.listActivity(input.id),
      ])
      if (conversation.organizationId !== ctx.organizationId) {
        return { ok: false as const, error: 'conversation not in this organization', errorCode: 'forbidden' }
      }
      return { ok: true as const, data: { conversation, activity } }
    } catch (err) {
      return {
        ok: false as const,
        error: err instanceof Error ? err.message : String(err),
        errorCode: 'not_found',
      }
    }
  },
  formatHint: 'json',
})

export const messagingReplyVerb = defineCliVerb({
  name: 'messaging reply',
  description: 'Send a staff reply on a conversation. Prefixed with the staff display name.',
  audience: 'admin',
  input: z.object({
    id: z.string().min(1),
    body: z.string().min(1),
  }),
  body: async ({ input, ctx }) => {
    if (ctx.principal.kind !== 'apikey' && ctx.principal.kind !== 'user') {
      return { ok: false as const, error: 'agent principals cannot send staff replies', errorCode: 'forbidden' }
    }
    try {
      const conversation = await conversationsSvc.get(input.id)
      if (conversation.organizationId !== ctx.organizationId) {
        return { ok: false as const, error: 'conversation not in this organization', errorCode: 'forbidden' }
      }
      const result = await sendStaffReply({
        conversationId: input.id,
        organizationId: ctx.organizationId,
        staffUserId: ctx.principal.id,
        body: input.body,
      })
      return { ok: true as const, data: { messageId: result.messageId } }
    } catch (err) {
      return {
        ok: false as const,
        error: err instanceof Error ? err.message : String(err),
        errorCode: 'reply_failed',
      }
    }
  },
  formatHint: 'json',
})

export const messagingCloseVerb = defineCliVerb({
  name: 'messaging close',
  description: 'Resolve (close) a conversation.',
  audience: 'staff',
  input: z.object({
    id: z.string().min(1),
    reason: z.string().optional(),
  }),
  body: async ({ input, ctx }) => {
    try {
      const conversation = await conversationsSvc.get(input.id)
      if (conversation.organizationId !== ctx.organizationId) {
        return { ok: false as const, error: 'conversation not in this organization', errorCode: 'forbidden' }
      }
      const updated = await conversationsSvc.resolve(input.id, ctx.principal.id, input.reason)
      return { ok: true as const, data: { id: updated.id, status: updated.status, resolvedAt: updated.resolvedAt } }
    } catch (err) {
      return {
        ok: false as const,
        error: err instanceof Error ? err.message : String(err),
        errorCode: 'close_failed',
      }
    }
  },
  formatHint: 'json',
})

export const messagingMessagesVerb = defineCliVerb({
  name: 'messaging messages',
  description:
    'List customer/agent/staff messages on a conversation with full bodies. Complements `messaging show` (which returns activity events but no message bodies).',
  audience: 'staff',
  input: z.object({
    id: z.string().min(1),
    limit: z.number().int().positive().max(500).default(50),
    since: z.string().datetime().optional(),
  }),
  body: async ({ input, ctx }) => {
    try {
      const conversation = await conversationsSvc.get(input.id)
      if (conversation.organizationId !== ctx.organizationId) {
        return { ok: false as const, error: 'conversation not in this organization', errorCode: 'forbidden' }
      }
      const rows = await listMessagesSvc(input.id, {
        limit: input.limit,
        since: input.since ? new Date(input.since) : undefined,
      })
      return {
        ok: true as const,
        data: rows.map((m) => ({
          id: m.id,
          role: m.role,
          kind: m.kind,
          summary: summarizeMessageContent(m.kind, m.content),
          createdAt: m.createdAt,
        })),
      }
    } catch (err) {
      return {
        ok: false as const,
        error: err instanceof Error ? err.message : String(err),
        errorCode: 'not_found',
      }
    }
  },
  formatHint: 'table:cols=createdAt,role,kind,summary,id',
})

export const messagingNotesVerb = defineCliVerb({
  name: 'messaging notes',
  description:
    'Render the conversation’s internal notes as a standalone markdown view (the staff-thread rows the agent sees interleaved in CONVERSATION.md).',
  audience: 'staff',
  input: z.object({ id: z.string().min(1) }),
  body: async ({ input, ctx }) => {
    try {
      const conversation = await conversationsSvc.get(input.id)
      if (conversation.organizationId !== ctx.organizationId) {
        return { ok: false as const, error: 'conversation not in this organization', errorCode: 'forbidden' }
      }
      const notes = await listNotes(input.id)
      return {
        ok: true as const,
        data: { conversationId: input.id, content: renderInternalNotesMd(notes) },
      }
    } catch (err) {
      return {
        ok: false as const,
        error: err instanceof Error ? err.message : String(err),
        errorCode: 'not_found',
      }
    }
  },
  formatHint: 'lines:field=content',
})

export const messagingVerbs = [
  messagingListVerb,
  messagingShowVerb,
  messagingMessagesVerb,
  messagingNotesVerb,
  messagingReplyVerb,
  messagingCloseVerb,
] as const
