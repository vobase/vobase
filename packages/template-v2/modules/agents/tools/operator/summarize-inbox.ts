/**
 * `summarize_inbox` — read-only operator-side scan of the org's active
 * conversations. Returns at most `limit` conversation summaries, ordered by
 * the underlying service's `lastMessageAt DESC`. The operator uses this for
 * heartbeat triage ("what's still open?") and to scope follow-up work.
 *
 * Read-only: no mutations, no events. Cheap enough to run multiple times per
 * wake — `parallelGroup: 'safe'`.
 */

import { list as listConversations } from '@modules/messaging/service/conversations'
import { type Static, Type } from '@sinclair/typebox'

import { defineAgentTool } from '../shared/define-tool'

export const SummarizeInboxInputSchema = Type.Object({
  tab: Type.Optional(
    Type.Union([Type.Literal('active'), Type.Literal('later'), Type.Literal('done')], { default: 'active' }),
  ),
  owner: Type.Optional(
    Type.String({
      description: '"all" | "unassigned" | "mine" | a specific assignee. Defaults to all.',
    }),
  ),
  limit: Type.Optional(Type.Integer({ minimum: 1, maximum: 200, default: 50 })),
})

export type SummarizeInboxToolInput = Static<typeof SummarizeInboxInputSchema>

export interface InboxRow {
  conversationId: string
  contactId: string
  channelInstanceId: string
  assignee: string
  status: string
  lastMessageAt: string | null
}

export const summarizeInboxTool = defineAgentTool({
  name: 'summarize_inbox',
  description:
    'Read-only scan of the org inbox. Returns conversation rows (id, contact, channel, assignee, status, last activity). Operator-only.',
  schema: SummarizeInboxInputSchema,
  errorCode: 'INBOX_ERROR',
  parallelGroup: 'safe',
  async run(args, ctx): Promise<{ rows: InboxRow[]; total: number }> {
    const all = await listConversations(ctx.organizationId, {
      tab: args.tab ?? 'active',
      owner: args.owner,
    })
    const limit = args.limit ?? 50
    const limited = all.slice(0, limit)
    const rows: InboxRow[] = limited.map((c) => ({
      conversationId: c.id,
      contactId: c.contactId,
      channelInstanceId: c.channelInstanceId,
      assignee: c.assignee,
      status: c.status,
      lastMessageAt: c.lastMessageAt ? new Date(c.lastMessageAt).toISOString() : null,
    }))
    return { rows, total: all.length }
  },
})
