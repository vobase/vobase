/**
 * Agent-facing surfaces for the messaging module.
 *
 * `tools` is static (all four messaging tools — reply, send_card, send_file,
 * book_slot) and reaches the harness via `collectAgentContributions`.
 *
 * Materializers are wake-time factories — `/contacts/<contactId>/<channelInstanceId>/`
 * paths encode `channelInstanceId`, which is only known once the wake resolves
 * its conversation. Renders the rolling transcript + internal notes from
 * `messages` and `conversation_internal_notes`.
 *
 * `conversationSideLoad` is the static "respond now" task instruction + the
 * rendered transcript + the contact profile block — composed by the wake
 * handler at `agent_start`. Lives here because the transcript + contact-block
 * rendering are messaging concerns.
 */

import { get as getContact } from '@modules/contacts/service/contacts'
import type { Message } from '@modules/messaging/schema'
import type { MessagingPort } from '@modules/messaging/service/types'
import type { AgentTool, SideLoadContributor, WorkspaceMaterializer } from '@vobase/core'

import { list as listMessages } from './service/messages'
import { messagingTools } from './tools'

export const tools: AgentTool[] = [...messagingTools]

// ─── Materializers ──────────────────────────────────────────────────────────

/** Read-only slice of MessagingPort the transcript + notes materializers depend on. */
export type MessagingReader = Pick<MessagingPort, 'listMessages' | 'listInternalNotes'>

export interface MessagingMaterializerOpts {
  messaging: MessagingReader
  contactId: string
  channelInstanceId: string
}

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

export function buildMessagingMaterializers(opts: MessagingMaterializerOpts): WorkspaceMaterializer[] {
  const folder = `/contacts/${opts.contactId}/${opts.channelInstanceId}`
  return [
    {
      path: `${folder}/messages.md`,
      phase: 'frozen',
      materialize: (ctx) => renderTranscript(opts.messaging, ctx.conversationId),
    },
    {
      path: `${folder}/internal-notes.md`,
      phase: 'frozen',
      materialize: (ctx) => renderInternalNotes(opts.messaging, ctx.conversationId),
    },
  ]
}

export { buildMessagingMaterializers as buildMaterializers }

// ─── Side-load ──────────────────────────────────────────────────────────────

export const conversationSideLoad: SideLoadContributor = async (ctx) => {
  const [msgs, contact] = await Promise.all([
    listMessages(ctx.conversationId, { limit: 200 }),
    getContact(ctx.contactId).catch(() => null),
  ])
  const transcript = renderTranscriptFromMessages(msgs)
  const contactBlock = contact
    ? `# Contact\n\nName: ${contact.displayName ?? '(unknown)'}\nPhone: ${contact.phone ?? ''}\nEmail: ${contact.email ?? ''}\nSegments: ${(contact.segments ?? []).join(', ') || '(none)'}\nNotes:\n${contact.notes || '(empty)'}\n`
    : '# Contact\n\n(no profile)\n'
  const instruction = [
    '# Task',
    '',
    'Respond to the customer now. PREFER `send_card` whenever the reply has any structure or actionable choices — pricing, plans, refund confirmations, yes/no with consequences, 2+ options, next-step CTAs. Use plain `reply` only for pure acknowledgements, free-form questions back to the customer, and single-sentence factual answers with no CTA. Keep prose replies to 2–4 short sentences.',
    '',
    '# Escalation + staff consultation (via bash)',
    '',
    "- `vobase team list` — see who's on the team and their availability/expertise.",
    '- `vobase team get --user=<userId>` — full profile for one staff member.',
    '- `vobase conv reassign --to=user:<userId> [--reason="..."]` — hand off when the customer explicitly asks for a human, or when the request is outside your authority (legal, large refunds, formal complaints). After reassigning, STOP replying — the customer now owns the conversation with that staff member.',
    '- `vobase conv ask-staff --mention=<userId> --body="question"` — post an internal note to ask staff a question you need answered before you can reply. Their reply will wake you again with the answer; in the meantime tell the customer briefly that you\'re checking.',
    '',
    'Before using `conv reassign` or `conv ask-staff`, ALWAYS run `vobase team list` first to get the real userIds. Do NOT invent userIds from names the customer used.',
    '',
    "If the answer depends on pricing or policy details you don't know, prefer `vobase conv ask-staff` over guessing.",
  ].join('\n')
  return [
    { kind: 'custom', priority: 100, render: () => instruction },
    { kind: 'custom', priority: 90, render: () => transcript },
    { kind: 'custom', priority: 80, render: () => contactBlock },
  ]
}
