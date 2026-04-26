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
import { Value } from '@sinclair/typebox/value'
import type { AgentTool, ToolContext, ToolResult } from '@vobase/core'

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

export const summarizeInboxTool: AgentTool<SummarizeInboxToolInput, { rows: InboxRow[]; total: number }> = {
  name: 'summarize_inbox',
  description:
    'Read-only scan of the org inbox. Returns conversation rows (id, contact, channel, assignee, status, last activity). Operator-only.',
  inputSchema: SummarizeInboxInputSchema,
  parallelGroup: 'safe',

  async execute(args, ctx: ToolContext): Promise<ToolResult<{ rows: InboxRow[]; total: number }>> {
    if (!Value.Check(SummarizeInboxInputSchema, args)) {
      const first = Value.Errors(SummarizeInboxInputSchema, args).First()
      return {
        ok: false,
        error: `Invalid summarize_inbox input — ${first ? `${first.path || 'root'}: ${first.message}` : 'unknown'}`,
        errorCode: 'VALIDATION_ERROR',
      }
    }
    try {
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
      return { ok: true, content: { rows, total: all.length } }
    } catch (err) {
      return {
        ok: false,
        error: err instanceof Error ? err.message : 'summarize_inbox failed',
        errorCode: 'INBOX_ERROR',
      }
    }
  },
}
