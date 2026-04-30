/**
 * Agent-facing surfaces for the messaging module.
 *
 * Materializers are wake-time factories — `/contacts/<contactId>/<channelInstanceId>/`
 * paths encode `channelInstanceId`, which is only known once the wake resolves
 * its conversation. They render the rolling transcript + internal notes from
 * `messages` and `conversation_internal_notes`.
 *
 * `conversationSideLoad` is the static "respond now" task instruction + the
 * rendered transcript + the contact profile block — composed by the wake
 * handler at `agent_start`. Lives here because the transcript + contact-block
 * rendering are messaging concerns.
 *
 * The agent-bash verbs `conv reassign` / `conv ask-staff` now live as
 * `defineCliVerb` definitions under `./verbs/`. Both the wake's bash sandbox
 * and the runtime CLI binary dispatch through the same `CliVerbRegistry`.
 */

import { get as getContact } from '@modules/contacts/service/contacts'
import type { Message } from '@modules/messaging/schema'
import type { MessagingIndexReader, MessagingReader } from '@modules/messaging/service/types'
import {
  type AgentTool,
  defineIndexContributor,
  type IndexContributor,
  type RoHintFn,
  type SideLoadContributor,
} from '@vobase/core'

import type { WakeMaterializerFactory } from '~/wake/context'

export type { MessagingIndexReader, MessagingReader }

import { addNoteTool } from './tools/add-note'
import { bookSlotTool } from './tools/book-slot'
import { draftEmailToReviewTool } from './tools/draft-email-to-review'
import { replyTool } from './tools/reply'
import { sendCardTool } from './tools/send-card'
import { sendFileTool } from './tools/send-file'
import { summarizeInboxTool } from './tools/summarize-inbox'

/**
 * RO-error hints for messaging-owned derived files: the conversation
 * timeline (`messages.md`) and `internal-notes.md`. Both are rendered from
 * `conversation_events` and accept mutations only via tool calls
 * (`reply` / `send_card` / `send_file` for messages; staff-authored notes
 * for internal-notes).
 */
export const messagingRoHints: RoHintFn[] = [
  (path) => {
    if (path.endsWith('/messages.md')) {
      return `bash: ${path}: Read-only filesystem.\n  The conversation timeline is derived from channel events. Use the \`reply\` tool (or \`send_card\`, \`send_file\`) to send a customer-visible message; do not append to this file.`
    }
    if (path.endsWith('/internal-notes.md')) {
      return `bash: ${path}: Read-only filesystem.\n  Internal notes are derived from staff-authored events in the messaging module. This file reflects, but does not accept, new notes.`
    }
    return null
  },
]

export const messagingTools: AgentTool[] = [
  replyTool,
  sendCardTool,
  sendFileTool,
  bookSlotTool,
  addNoteTool,
  summarizeInboxTool,
  draftEmailToReviewTool,
]

export { addNoteTool, bookSlotTool, draftEmailToReviewTool, replyTool, sendCardTool, sendFileTool, summarizeInboxTool }

const AGENTS_MD_FILE = 'AGENTS.md'

// Cross-cutting prose only — describes the conversation FILES the agent
// reads. Per-verb guidance ("when to use `conv reassign`") and per-tool
// guidance ("when to use `reply` vs `send_card`") now live next to the
// verb/tool definitions and render under `## Commands` / `## Tool guidance`
// in AGENTS.md. Add behavioural caveats here only when they span multiple
// verbs/tools (e.g. "the timeline is derived, never echo >> into it").
export const messagingAgentsMdContributors: readonly IndexContributor[] = [
  defineIndexContributor({
    file: AGENTS_MD_FILE,
    priority: 50,
    name: 'messaging.conversation-surface',
    render: () =>
      [
        '## Conversation surface',
        '',
        '- `/contacts/<id>/<channelInstanceId>/messages.md` — customer-visible timeline (read-only). Reflects, but does not accept, new messages.',
        '- `/contacts/<id>/<channelInstanceId>/internal-notes.md` — staff ↔ agent notes (read-only). Reflects, but does not accept, new notes.',
        '',
        'The timeline files are materialized from the database — never `echo >>` into them. Send customer-visible content via the `reply` / `send_card` / `send_file` / `book_slot` tools (see `## Tool guidance`). Mutate conversation state via `vobase conv reassign` / `vobase conv ask-staff` (see `## Commands`).',
      ].join('\n'),
  }),
]

import { list as listMessages } from './service/messages'
import { listNotes as listInternalNotes } from './service/notes'

// ─── Materializers ──────────────────────────────────────────────────────────

const messagingReader: MessagingReader = { listMessages, listInternalNotes }

export function renderTranscriptFromMessages(msgs: readonly Message[]): string {
  if (msgs.length === 0) return '# Conversation\n\n_No messages yet._\n'
  const lines = ['# Conversation', '']
  for (const m of msgs) {
    const role = m.role === 'customer' ? 'Customer' : m.role === 'agent' ? 'Agent' : 'System'
    const text =
      m.kind === 'text'
        ? ((m.content as { text?: string }).text ?? '')
        : m.kind === 'card'
          ? `[card: ${JSON.stringify(m.content)}]`
          : m.kind === 'card_reply'
            ? `[card reply: ${JSON.stringify(m.content)}]`
            : `[${m.kind}]`
    lines.push(`**${role}** (${new Date(m.createdAt).toISOString()}):`)
    lines.push(text, '')
  }
  return lines.join('\n')
}

export async function renderTranscript(messaging: MessagingReader, conversationId: string): Promise<string> {
  const msgs = (await messaging.listMessages(conversationId, { limit: 200 })) as Message[]
  return renderTranscriptFromMessages(msgs)
}

export async function renderInternalNotes(messaging: MessagingReader, conversationId: string): Promise<string> {
  const notes = await messaging.listInternalNotes(conversationId).catch(() => [])
  if (notes.length === 0) return '# Internal Notes\n\n_No notes yet._\n'
  const lines = ['# Internal Notes', '']
  for (const n of notes) {
    const mentions = n.mentions.length > 0 ? ` (@${n.mentions.join(' @')})` : ''
    lines.push(`**${n.authorType}:${n.authorId}** (${new Date(n.createdAt).toISOString()})${mentions}:`)
    lines.push(n.body, '')
  }
  return lines.join('\n')
}

export const messagingMaterializerFactory: WakeMaterializerFactory = (ctx) => {
  if (!ctx.contactId || !ctx.channelInstanceId) return []
  const folder = `/contacts/${ctx.contactId}/${ctx.channelInstanceId}`
  return [
    {
      path: `${folder}/messages.md`,
      phase: 'frozen',
      materialize: (mctx) => renderTranscript(messagingReader, mctx.conversationId),
    },
    {
      path: `${folder}/internal-notes.md`,
      phase: 'frozen',
      materialize: (mctx) => renderInternalNotes(messagingReader, mctx.conversationId),
    },
  ]
}

// ─── Index contributors ────────────────────────────────────────────────────

export interface MessagingIndexContributorOpts {
  organizationId: string
  conversations: MessagingIndexReader
}

const INDEX_FILE = 'INDEX.md'
const INDEX_OPEN_CONVERSATIONS_LIMIT = 10

export async function loadMessagingIndexContributors(opts: MessagingIndexContributorOpts): Promise<IndexContributor[]> {
  const open = await opts.conversations.list(opts.organizationId, { tab: 'active' }).catch(() => [])
  return [
    defineIndexContributor({
      file: INDEX_FILE,
      priority: 100,
      name: 'messaging.openConversations',
      render: () => {
        if (open.length === 0) return null
        const top = open.slice(0, INDEX_OPEN_CONVERSATIONS_LIMIT)
        const lines = [`# Open Conversations (${open.length})`, '']
        for (const c of top) {
          const last = c.lastMessageAt ? new Date(c.lastMessageAt).toISOString() : 'never'
          lines.push(
            `- /contacts/${c.contactId}/${c.channelInstanceId}/messages.md — assignee=${c.assignee} status=${c.status} last=${last}`,
          )
        }
        if (open.length > top.length) lines.push(`- … and ${open.length - top.length} more`)
        return lines.join('\n')
      },
    }),
  ]
}

export { loadMessagingIndexContributors as loadIndexContributors }

// ─── Side-load ──────────────────────────────────────────────────────────────

export const conversationSideLoad: SideLoadContributor = async (ctx) => {
  // Self-gate: standalone-lane wakes (operator-thread, heartbeat) pass an
  // empty `contactId` because they aren't conversation-bound. Skip there so
  // this contributor can flow through `collectAgentContributions` without
  // polluting standalone wakes.
  if (!ctx.contactId) return []
  const [msgs, contact] = await Promise.all([
    listMessages(ctx.conversationId, { limit: 200 }),
    getContact(ctx.contactId).catch(() => null),
  ])
  const transcript = renderTranscriptFromMessages(msgs)
  const contactBlock = contact
    ? `# Contact\n\nName: ${contact.displayName ?? '(unknown)'}\nPhone: ${contact.phone ?? ''}\nEmail: ${contact.email ?? ''}\nSegments: ${(contact.segments ?? []).join(', ') || '(none)'}\nMemory:\n${contact.memory || '(empty)'}\n`
    : '# Contact\n\n(no profile)\n'
  const instruction = [
    '# Task',
    '',
    'Respond to the customer now. PREFER `send_card` whenever the reply has any structure or actionable choices — pricing, plans, refund confirmations, yes/no with consequences, 2+ options, next-step CTAs. Use plain `reply` only for pure acknowledgements, free-form questions back to the customer, and single-sentence factual answers with no CTA. Keep prose replies to 2–4 short sentences.',
  ].join('\n')
  return [
    { kind: 'custom', priority: 100, render: () => instruction },
    { kind: 'custom', priority: 90, render: () => transcript },
    { kind: 'custom', priority: 80, render: () => contactBlock },
  ]
}

export const messagingAgent = {
  tools: messagingTools,
  sideLoad: [conversationSideLoad],
  agentsMd: [...messagingAgentsMdContributors],
  materializers: [messagingMaterializerFactory],
  roHints: [...messagingRoHints],
}
