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
 * The agent-bash verb `conv reassign` lives as a `defineCliVerb` definition
 * under `./verbs/`. Both the wake's bash sandbox and the runtime CLI binary
 * dispatch through the same `CliVerbRegistry`. Asking staff a question is
 * handled by `add_note` with `mentions` (see `./tools/add-note.ts`) — the
 * post-commit fan-out enqueues a supervisor wake per mentioned staff and
 * customer-facing tools stay available when staff replies.
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

import { getWakeAgentsMdScratch } from '~/wake/agents-md-scratch'
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
        'The timeline files are materialized from the database — never `echo >>` into them. Send customer-visible content via the `reply` / `send_card` / `send_file` / `book_slot` tools (see `## Tool guidance`). Reassign with `vobase conv reassign` (see `## Commands`); ask staff a question by calling `add_note` with `mentions` populated.',
      ].join('\n'),
  }),
  // Lane-aware blocks. Conditional on `getWakeAgentsMdScratch(ctx)` — return
  // null when the wake doesn't match (or scratch is absent, e.g. UI preview
  // without synthetic context). These describe HARNESS facts that name
  // messaging concepts (`reply`, `add_note`, mentions-as-ask-staff, internal
  // notes), so the prose lives in messaging — not the framework.
  defineIndexContributor({
    file: AGENTS_MD_FILE,
    priority: 60,
    name: 'messaging.supervisor-coaching',
    render: (ctx) => {
      const wake = getWakeAgentsMdScratch(ctx)
      if (wake?.lane !== 'conversation' || wake.triggerKind !== 'supervisor' || wake.supervisorKind !== 'coaching') {
        return null
      }
      return [
        '## When the staff note is coaching (current wake)',
        '',
        'A staff member posted an internal note as **coaching** — feedback or context, not a request to send another customer reply. Customer-facing tools (`reply`, `send_card`, `send_file`, `book_slot`) have been stripped from this wake by the harness; they will not appear in your tool list.',
        '',
        'Required steps:',
        '',
        '1. Capture the lesson in the right `MEMORY.md`. Customer-specific facts (about a particular contact: plan tier, history, preferences, a recent purchase) → `/contacts/<contactId>/MEMORY.md`. Facts about your own behaviour, escalation rules, or voice → `/agents/<your-id>/MEMORY.md`. Facts about a specific teammate → `/staff/<staffId>/MEMORY.md`.',
        '2. Acknowledge with `add_note` so staff sees the loop closed — one or two sentences summarising what you captured and where.',
        '3. End the turn.',
        '',
        'If the staff note is ambiguous, post an `add_note` asking for clarification instead of guessing.',
      ].join('\n')
    },
  }),
  defineIndexContributor({
    file: AGENTS_MD_FILE,
    priority: 60,
    name: 'messaging.supervisor-ask-staff-answer',
    render: (ctx) => {
      const wake = getWakeAgentsMdScratch(ctx)
      if (
        wake?.lane !== 'conversation' ||
        wake.triggerKind !== 'supervisor' ||
        wake.supervisorKind !== 'ask_staff_answer'
      ) {
        return null
      }
      return [
        '## When staff has answered your question (current wake)',
        '',
        'Staff is replying to a prior `add_note` of yours that mentioned them. Customer-facing tools remain available — relay the answer back to the customer with `reply` or `send_card`, then end the turn. Do not re-ping staff unless the answer is incomplete.',
      ].join('\n')
    },
  }),
  defineIndexContributor({
    file: AGENTS_MD_FILE,
    priority: 60,
    name: 'messaging.standalone-no-customer',
    render: (ctx) => {
      const wake = getWakeAgentsMdScratch(ctx)
      if (wake?.lane !== 'standalone') return null
      return [
        '## No customer is on the line (current wake)',
        '',
        'This is a standalone-lane wake (operator thread or scheduled heartbeat). No customer is waiting for a reply — customer-facing tools (`reply`, `send_card`, `send_file`, `book_slot`) are absent from your tool list by design. Use `add_note` if you need to leave a note on a conversation, or write into the operator thread directly.',
      ].join('\n')
    },
  }),
]

import { type DriveFileProjection, getDriveFilesByIds as readDriveFilesByIds } from './service/drive-attachments'
import { list as listMessages } from './service/messages'
import { listNotes as listInternalNotes } from './service/notes'

// ─── Materializers ──────────────────────────────────────────────────────────

const messagingReader: MessagingReader = {
  listMessages,
  listInternalNotes,
}

function humanSize(bytes: number | null | undefined): string {
  if (!bytes || bytes <= 0) return '0 B'
  if (bytes < 1024) return `${bytes} B`
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`
}

function renderAttachmentBlock(
  ref: { driveFileId: string; path: string; caption: string | null; mimeType: string; sizeBytes: number },
  driveFile: DriveFileProjection | undefined,
): string {
  // Path drift handling: prefer the live drive row's path; fall back to
  // the denormalized jsonb path. If the drive row is missing entirely
  // (rare — janitor cleanup or out-of-band delete), surface as
  // `unavailable` so the agent does not chase a 404 path.
  if (!driveFile) {
    return `[file: ${ref.path} — unavailable]`
  }
  const path = driveFile.path
  if (driveFile.extractionKind === 'binary-stub') {
    return `[binary: ${path} (${ref.mimeType}, ${humanSize(ref.sizeBytes)})]`
  }
  if (driveFile.extractionKind === 'failed') {
    return `[file: ${path} — extraction_failed]`
  }
  if (driveFile.extractionKind === 'pending') {
    return `[file: ${path} — pending extraction]`
  }
  // extracted
  const caption = driveFile.caption ?? ref.caption ?? '(no caption)'
  return `[file: ${path}]\n  > ${caption}\n  > (cat for full text)`
}

/**
 * Render the conversation transcript with optional drive-attachment
 * caption blocks per message.
 *
 * Drive enrichment is a per-wake snapshot. Path drift from re-extraction
 * (mime reclassification) surfaces on the NEXT wake, never mid-turn —
 * consistent with the frozen-snapshot rule. A single materialization
 * sees a single drive state.
 */
export function renderTranscriptFromMessages(
  msgs: readonly Message[],
  driveFilesById: Map<string, DriveFileProjection> = new Map(),
): string {
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
    lines.push(text)
    for (const att of m.attachments ?? []) {
      const driveFile = driveFilesById.get(att.driveFileId)
      lines.push(renderAttachmentBlock(att, driveFile))
    }
    lines.push('')
  }
  return lines.join('\n')
}

function collectAttachmentIds(msgs: readonly Message[]): string[] {
  const ids = new Set<string>()
  for (const m of msgs) for (const a of m.attachments ?? []) ids.add(a.driveFileId)
  return [...ids]
}

export async function renderTranscript(
  messaging: MessagingReader,
  conversationId: string,
  driveFilesById?: Map<string, DriveFileProjection>,
): Promise<string> {
  const msgs = (await messaging.listMessages(conversationId, { limit: 200 })) as Message[]
  return renderTranscriptFromMessages(msgs, driveFilesById ?? new Map())
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

/**
 * Per-wake attachment-prefetch cache. Keyed by `${orgId}:${conversationId}`,
 * invalidated at the top of every wake (when the materializer factory
 * runs) and shared between the initial `messages.md` materialization and
 * `conversationSideLoad`'s per-turn re-render so a single wake issues
 * exactly ONE batched drive query for attachment enrichment.
 */
const wakeAttachmentSnapshot = new Map<string, Promise<Map<string, DriveFileProjection>>>()

function attachmentCacheKey(organizationId: string, conversationId: string): string {
  return `${organizationId}:${conversationId}`
}

async function prefetchAttachmentsForConversation(
  organizationId: string,
  conversationId: string,
): Promise<Map<string, DriveFileProjection>> {
  const msgs = (await messagingReader.listMessages(conversationId, { limit: 200 })) as Message[]
  const ids = collectAttachmentIds(msgs)
  if (ids.length === 0) return new Map()
  return readDriveFilesByIds(organizationId, ids)
}

export async function getAttachmentSnapshot(
  organizationId: string,
  conversationId: string,
): Promise<Map<string, DriveFileProjection>> {
  const key = attachmentCacheKey(organizationId, conversationId)
  let pending = wakeAttachmentSnapshot.get(key)
  if (!pending) {
    pending = prefetchAttachmentsForConversation(organizationId, conversationId)
    wakeAttachmentSnapshot.set(key, pending)
  }
  return pending
}

export function invalidateAttachmentSnapshot(organizationId: string, conversationId: string): void {
  wakeAttachmentSnapshot.delete(attachmentCacheKey(organizationId, conversationId))
}

export const messagingMaterializerFactory: WakeMaterializerFactory = (ctx) => {
  if (!ctx.contactId || !ctx.channelInstanceId) return []
  // Invalidate the per-wake snapshot at wake start. The materializer
  // callback below seeds the cache lazily on first call; the side-load
  // contributor reads from it on subsequent turns. Frozen-snapshot rule:
  // mid-wake `request_caption` writes do NOT mutate this map — they
  // surface in the NEXT wake's factory invocation.
  invalidateAttachmentSnapshot(ctx.organizationId, ctx.conversationId)
  const folder = `/contacts/${ctx.contactId}/${ctx.channelInstanceId}`
  return [
    {
      path: `${folder}/messages.md`,
      phase: 'frozen',
      materialize: async (mctx) => {
        const snapshot = await getAttachmentSnapshot(ctx.organizationId, mctx.conversationId)
        return renderTranscript(messagingReader, mctx.conversationId, snapshot)
      },
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
  const [msgs, contact, driveFilesById] = await Promise.all([
    listMessages(ctx.conversationId, { limit: 200 }),
    getContact(ctx.contactId).catch(() => null),
    getAttachmentSnapshot(ctx.organizationId, ctx.conversationId),
  ])
  const transcript = renderTranscriptFromMessages(msgs, driveFilesById)
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
