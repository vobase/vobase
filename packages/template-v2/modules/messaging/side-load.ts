/**
 * Conversation-side-load contributor.
 *
 * Composite of (a) the rolling transcript materialised from `messages`,
 * (b) the contact profile block, and (c) the static "respond now" task
 * instruction the agent reads at the top of every wake. Was inline in
 * `wake-handler.ts` until the wake decomposition; lives in messaging
 * because the transcript + contact-block rendering are messaging concerns.
 */

import { get as getContact } from '@modules/contacts/service/contacts'
import type { SideLoadContributor } from '@vobase/core'

import { renderTranscriptFromMessages } from './materializers'
import { list as listMessages } from './service/messages'

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
