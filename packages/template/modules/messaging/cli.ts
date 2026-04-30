/**
 * `vobase messaging {list,show,reply,close}` verb registrations.
 *
 * `messaging` is the customer-conversation surface — the high-value verb
 * group an agent (in-process transport) or human supervisor (CLI binary)
 * actually wants. Verbs route through the singleton service
 * exports + staff-reply writer to honor the messaging module's
 * "one-write-path" rule.
 */

import { defineCliVerb } from '@vobase/core'
import { z } from 'zod'

import * as conversationsSvc from './service/conversations'
import { sendStaffReply } from './service/staff-reply'

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

export const messagingVerbs = [messagingListVerb, messagingShowVerb, messagingReplyVerb, messagingCloseVerb] as const
