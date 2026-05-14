/**
 * Agent-facing surfaces for the messaging module.
 *
 * Materializers are wake-time factories — `/contacts/<contactId>/<channelInstanceId>/`
 * paths encode `channelInstanceId`, which is only known once the wake resolves
 * its conversation. They render `CONVERSATION.md` — one interleaved timeline of
 * customer messages and internal staff notes from `messages` and
 * `internal_notes`.
 *
 * `conversationSideLoad` is the static "respond now" task instruction + the
 * rendered conversation timeline + the contact profile block — composed by the
 * wake handler at `agent_start`. Lives here because the timeline + contact-block
 * rendering are messaging concerns.
 *
 * The agent-bash verb `conv reassign` lives as a `defineCliVerb` definition
 * under `./verbs/`. Both the wake's bash sandbox and the runtime CLI binary
 * dispatch through the same `CliVerbRegistry`. Messaging a staff colleague is
 * handled by `consult_staff` (see `./tools/consult-staff.ts`) — the note's
 * mention fan-out notifies each addressed staff member and their reply
 * enqueues a staff-note wake. `add_note` is the undirected breadcrumb variant
 * with no recipient.
 */

import { get as getContact } from '@modules/contacts/service/contacts'
import type { InternalNote, Message } from '@modules/messaging/schema'
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
import { consultStaffTool } from './tools/consult-staff'
import { draftEmailToReviewTool } from './tools/draft-email-to-review'
import { replyContactTool } from './tools/reply-contact'
import { sendCardTool } from './tools/send-card'
import { sendFileTool } from './tools/send-file'
import { summarizeInboxTool } from './tools/summarize-inbox'

/**
 * RO-error hint for the messaging-owned derived file `CONVERSATION.md` — the
 * single interleaved timeline of customer messages and internal staff notes.
 * It accepts mutations only via tool calls: `reply_contact` / `send_card` /
 * `send_file` for the customer; `consult_staff` / `add_note` for the staff thread.
 */
export const messagingRoHints: RoHintFn[] = [
  (path) => {
    if (path.endsWith('/CONVERSATION.md')) {
      return `bash: ${path}: Read-only file.\n  This is the full conversation timeline — customer messages and internal staff notes interleaved. Use \`reply_contact\` (or \`send_card\`, \`send_file\`) to message the customer; \`consult_staff\` to message a colleague, or \`add_note\` to leave a breadcrumb. Do not append to this file.`
    }
    return null
  },
]

export const messagingTools: AgentTool[] = [
  replyContactTool,
  sendCardTool,
  sendFileTool,
  consultStaffTool,
  addNoteTool,
  summarizeInboxTool,
  draftEmailToReviewTool,
]

export {
  addNoteTool,
  consultStaffTool,
  draftEmailToReviewTool,
  replyContactTool,
  sendCardTool,
  sendFileTool,
  summarizeInboxTool,
}

const AGENTS_MD_FILE = 'AGENTS.md'

// Cross-cutting prose only — describes the conversation FILES the agent
// reads. Per-verb guidance ("when to use `conv reassign`") and per-tool
// guidance ("when to use `reply_contact` vs `send_card`") now live next to
// the verb/tool definitions and render under `## Commands` / `## Tool
// guidance` in AGENTS.md. Add behavioural caveats here only when they span
// multiple verbs/tools (e.g. "the timeline is read-only, never echo >> into it").
export const messagingAgentsMdContributors: readonly IndexContributor[] = [
  defineIndexContributor({
    file: AGENTS_MD_FILE,
    priority: 50,
    name: 'messaging.conversation-surface',
    render: () => {
      return [
        '## Conversation surface',
        '',
        '`/contacts/<id>/<channelInstanceId>/CONVERSATION.md` is the full timeline of this conversation — customer messages, your replies, and internal staff notes, interleaved in time order. Read it before you act. Rows are audience-labelled:',
        '',
        '- `**Customer**` / `**Agent → customer**` / `**Staff → customer**` — the customer-visible thread. What the customer sees.',
        '- `**[internal] …**` — the staff thread. You and your colleagues; the customer never sees these rows. An `[internal]` row newer than your last action means a colleague is waiting on you.',
        '',
        'Write to the customer with `reply_contact` / `send_card` / `send_file`; to a staff colleague with `consult_staff`; an undirected breadcrumb with `add_note`. Reassign with `vobase conv reassign`. See `## Tool guidance` for when to use each.',
        '',
        'Your wake cue may end with `## Other recent activity (context)`, a read-only appendix of customer/staff messages and notes from non-self authors since your last reply (debounced bursts and any notes between wakes land here). The trigger at the top is why this wake fired; the appendix is the surrounding context.',
      ].join('\n')
    },
  }),
  // Lane-aware blocks. Conditional on `getWakeAgentsMdScratch(ctx)` — return
  // null when the wake doesn't match (or scratch is absent, e.g. UI preview
  // without synthetic context). These describe HARNESS facts that name
  // messaging concepts (`consult_staff`, `add_note`, the staff thread), so the
  // prose lives in messaging — not the framework.
  defineIndexContributor({
    file: AGENTS_MD_FILE,
    priority: 60,
    name: 'messaging.staff-note',
    render: (ctx) => {
      const wake = getWakeAgentsMdScratch(ctx)
      if (wake?.lane !== 'conversation' || wake.triggerKind !== 'staff_note') return null
      return [
        '## Staff note (this wake)',
        '',
        'A staff member left a note. Decide what it asks for — fix an artifact, relay to the customer, or both. Brief bodies (a fact, a correction, yes/no) often answer a prior note of yours, with the customer still waiting on that answer; the same fact tends to be durable too, so it usually belongs in a drive doc or memory so the gap does not reappear next wake.',
        '',
        '**Step 1 — read the artifact the note mentions** before doing anything else:',
        '',
        '| If the note mentions… | Read this first |',
        '| --- | --- |',
        '| a skill or playbook | `cat /agents/<id>/skills/<name>/SKILL.md` (or `ls /agents/<id>/skills/`) |',
        '| a contact | `cat /contacts/<id>/MEMORY.md` and `INTERNAL-NOTES.md` |',
        '| a company doc or policy | `cat /drive/<doc>.md` |',
        '| a staff member | `cat /staff/<id>/MEMORY.md` |',
        '',
        '**Step 2 — apply the fix or relay** (more than one often applies — a staff answer is both a thing to send and a thing to remember):',
        '',
        '- Wrong or missing skill → `remember(scope=agents.learned_skill, resourceId=<kebab-name>, body=<rewritten skill>)`',
        '- Company doc needs updating → `vobase drive propose --path=/drive/<doc>.md --body="..."`',
        '- Contact field is wrong → `vobase contacts propose-change --id <id> --field <name> --to "..."`',
        '- Durable behaviour rule (no specific file) → `echo "- rule" >> /agents/<id>/MEMORY.md`',
        '- Per-staff preference → `echo "- pref" >> /staff/<staffId>/MEMORY.md`',
        '- Note is staff answering a prior question of yours → relay the answer to the customer with `reply_contact` or `send_card`',
        '',
        '**Step 3 — reply to the staff member** with `consult_staff` (address the note author). Short, conversational, ≤10 words; lead with the verb.',
        'e.g. "Got it — rewrote stale-triage.", "Sent the answer to the customer.", "Pinned to Tarun\'s memory."',
        '',
        'If the note is unclear after reading the artifact, use `consult_staff` to ask the author — do not guess.',
        'An empty turn with no preceding artifact write, customer reply, or `consult_staff` message is a failure mode — never end the turn that way.',
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
        'Standalone wake — no customer is waiting. Customer-facing tools are absent. Use `consult_staff` to message a colleague on a conversation, `add_note` to leave a breadcrumb, or write into the operator thread directly.',
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

/** One timeline row — a message or a note — carrying sort keys for the merge. */
interface ConversationEntry {
  ts: number
  /** 0 = message, 1 = note: messages sort before notes at an equal timestamp. */
  rank: 0 | 1
  id: string
  lines: string[]
}

function messageRoleLabel(role: Message['role']): string {
  if (role === 'customer') return 'Customer'
  if (role === 'agent') return 'Agent → customer'
  if (role === 'staff') return 'Staff → customer'
  return 'System'
}

function messageText(m: Message): string {
  if (m.kind === 'text') return (m.content as { text?: string }).text ?? ''
  if (m.kind === 'card') return `[card: ${JSON.stringify(m.content)}]`
  if (m.kind === 'card_reply') return `[card reply: ${JSON.stringify(m.content)}]`
  return `[${m.kind}]`
}

/**
 * Prefix every line of untrusted body text with `> `. The `**…**` row headers
 * are the only thing telling the agent whether a row is customer-visible or
 * the internal staff thread; blockquoting message text and note bodies keeps a
 * column-0 `**` renderer-only, so a customer message or staff note body cannot
 * typographically forge a row of a different audience.
 */
function blockquoteBody(body: string): string {
  return body
    .split('\n')
    .map((line) => `> ${line}`)
    .join('\n')
}

function messageEntry(m: Message, driveFilesById: Map<string, DriveFileProjection>): ConversationEntry {
  const created = new Date(m.createdAt)
  const lines = [`**${messageRoleLabel(m.role)}** (${created.toISOString()}):`, blockquoteBody(messageText(m))]
  for (const att of m.attachments ?? []) {
    lines.push(renderAttachmentBlock(att, driveFilesById.get(att.driveFileId)))
  }
  return { ts: created.getTime(), rank: 0, id: m.id, lines }
}

function noteEntry(n: InternalNote): ConversationEntry {
  const created = new Date(n.createdAt)
  const who = n.authorType === 'staff' ? `Staff:${n.authorId}` : n.authorType === 'agent' ? 'Agent' : 'System'
  // Mentions are system-generated `staff:<userId>` tokens — strip anything
  // outside the id charset so a malformed token can't break the header line.
  const tokens = n.mentions.map((t) => t.replace(/[^\w:.-]/g, ''))
  const mentions = tokens.length > 0 ? ` (@${tokens.join(' @')})` : ''
  return {
    ts: created.getTime(),
    rank: 1,
    id: n.id,
    lines: [`**[internal] ${who}** (${created.toISOString()})${mentions}:`, blockquoteBody(n.body)],
  }
}

/**
 * Render the conversation as ONE interleaved timeline — customer messages, the
 * agent's replies, and internal staff notes — ordered by `createdAt`. Rows are
 * audience-labelled: customer-visible rows (`**Customer**`, `**Agent →
 * customer**`, `**Staff → customer**`) and internal rows (`**[internal] …**`,
 * the staff thread the customer never sees).
 *
 * The merge is deterministic — equal timestamps break ties by (message before
 * note, then id) — so the file is byte-stable across re-renders within a wake,
 * preserving the frozen-snapshot `systemHash` invariant. Drive enrichment is a
 * per-wake snapshot: path drift from re-extraction surfaces on the NEXT wake,
 * never mid-turn.
 */
export function renderConversation(
  msgs: readonly Message[],
  notes: readonly InternalNote[],
  driveFilesById: Map<string, DriveFileProjection> = new Map(),
): string {
  if (msgs.length === 0 && notes.length === 0) return '# Conversation\n\n_No messages yet._\n'
  const entries: ConversationEntry[] = [
    ...msgs.map((m) => messageEntry(m, driveFilesById)),
    ...notes.map(noteEntry),
  ].sort((a, b) => a.ts - b.ts || a.rank - b.rank || (a.id < b.id ? -1 : a.id > b.id ? 1 : 0))
  const lines = ['# Conversation', '']
  for (const e of entries) lines.push(...e.lines, '')
  return lines.join('\n')
}

function collectAttachmentIds(msgs: readonly Message[]): string[] {
  const ids = new Set<string>()
  for (const m of msgs) for (const a of m.attachments ?? []) ids.add(a.driveFileId)
  return [...ids]
}

export async function renderConversationFromSources(
  messaging: MessagingReader,
  conversationId: string,
  driveFilesById?: Map<string, DriveFileProjection>,
): Promise<string> {
  const [msgs, notes] = await Promise.all([
    messaging.listMessages(conversationId, { limit: 200 }) as Promise<Message[]>,
    messaging.listInternalNotes(conversationId).catch(() => [] as InternalNote[]),
  ])
  return renderConversation(msgs, notes, driveFilesById ?? new Map())
}

/**
 * Per-wake attachment-prefetch cache. Keyed by `${orgId}:${conversationId}`,
 * invalidated at the top of every wake (when the materializer factory
 * runs) and shared between the initial `CONVERSATION.md` materialization and
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

export function getAttachmentSnapshot(
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
      path: `${folder}/CONVERSATION.md`,
      phase: 'frozen',
      materialize: async (mctx) => {
        const snapshot = await getAttachmentSnapshot(ctx.organizationId, mctx.conversationId)
        return renderConversationFromSources(messagingReader, mctx.conversationId, snapshot)
      },
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
            `- /contacts/${c.contactId}/${c.channelInstanceId}/CONVERSATION.md — assignee=${c.assignee} status=${c.status} last=${last}`,
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
  const [msgs, notes, contact, driveFilesById] = await Promise.all([
    listMessages(ctx.conversationId, { limit: 200 }),
    listInternalNotes(ctx.conversationId).catch(() => [] as InternalNote[]),
    getContact(ctx.contactId).catch(() => null),
    getAttachmentSnapshot(ctx.organizationId, ctx.conversationId),
  ])
  const transcript = renderConversation(msgs, notes, driveFilesById)
  const contactBlock = contact
    ? `# Contact\n\nName: ${contact.displayName ?? '(unknown)'}\nPhone: ${contact.phone ?? ''}\nEmail: ${contact.email ?? ''}\nSegments: ${(contact.segments ?? []).join(', ') || '(none)'}\nMemory:\n${contact.memory || '(empty)'}\n`
    : '# Contact\n\n(no profile)\n'
  const instruction = [
    '# Task',
    '',
    'You serve two audiences on this conversation: the customer, and your staff colleagues.',
    '',
    "1. First check the staff thread. If a colleague is waiting on you, or the customer's request needs a judgment call, a policy exception, missing information, or anything you cannot ground in the workspace — use `consult_staff` to address them. Consulting staff before replying is the norm for non-trivial cases, not a last resort.",
    '2. Then respond to the customer, grounded in what you have read. PREFER `send_card` whenever the reply has any structure or actionable choices — pricing, plans, refund confirmations, yes/no with consequences, 2+ options, next-step CTAs. Use plain `reply_contact` only for pure acknowledgements, free-form questions back to the customer, and single-sentence factual answers with no CTA. Keep prose replies to 2–4 short sentences.',
  ].join('\n')

  // Unaddressed staff content: a staff/system note newer than the agent's
  // last action (its last customer message or its last breadcrumb). When one
  // exists, push a banner above the transcript so the waiting colleague is
  // unmissable — the `[internal]` row itself is already inline in CONVERSATION.md.
  const lastAgentActivityAt = Math.max(
    0,
    ...msgs.filter((m) => m.role === 'agent').map((m) => new Date(m.createdAt).getTime()),
    ...notes.filter((n) => n.authorType === 'agent').map((n) => new Date(n.createdAt).getTime()),
  )
  const hasUnaddressedStaffNote = notes.some(
    (n) => n.authorType !== 'agent' && new Date(n.createdAt).getTime() > lastAgentActivityAt,
  )
  const staffBanner =
    '⚠ An `[internal]` note in CONVERSATION.md is newer than your last action — a colleague is waiting on you. Read it and respond with `consult_staff` before replying to the customer.'

  return [
    { kind: 'custom' as const, priority: 100, render: () => instruction },
    ...(hasUnaddressedStaffNote ? [{ kind: 'custom' as const, priority: 95, render: () => staffBanner }] : []),
    { kind: 'custom' as const, priority: 90, render: () => transcript },
    { kind: 'custom' as const, priority: 80, render: () => contactBlock },
  ]
}

export const messagingAgent = {
  tools: messagingTools,
  sideLoad: [conversationSideLoad],
  agentsMd: [...messagingAgentsMdContributors],
  materializers: [messagingMaterializerFactory],
  roHints: [...messagingRoHints],
}
