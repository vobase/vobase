/**
 * WhatsApp adapter agent surface — AGENTS.md fragment for echo coexistence.
 *
 * When staff send messages via the WhatsApp Business App (SMB coexistence),
 * those messages arrive as echoes with `role='staff', metadata.echo=true`. The
 * agent sees them in `CONVERSATION.md` on the next turn's side-load and must
 * stay silent so it doesn't talk over the human staffer.
 *
 * `whatsappAgentsMdContributors` is the canonical export aggregated by the
 * channels umbrella's `agent.ts` (pattern mirrors `messaging/agent.ts`).
 *
 * The echo block renders only on conversation-lane wakes — standalone
 * (operator/heartbeat) wakes don't see `CONVERSATION.md` so the rule is moot.
 */
import { defineIndexContributor, type HarnessPlatformHint, type IndexContributor } from '@vobase/core'

import { getWakeAgentsMdScratch } from '~/wake/agents-md-scratch'

const AGENTS_MD_FILE = 'AGENTS.md'

export const whatsappAgentsMd = `## WhatsApp coexistence echoes

Some \`role='staff'\` messages have \`metadata.echoSource = 'business_app'\` — a human staffer sent those directly from the WhatsApp Business App.

**When you see an echo: stay silent.** Do not reply, send a card, leave a note, or reassign. The staffer is handling it. End the turn cleanly. Normal behaviour resumes on the next customer-driven wake.
`

export const whatsappAgentsMdContributors: readonly IndexContributor[] = [
  defineIndexContributor({
    file: AGENTS_MD_FILE,
    priority: 55,
    name: 'channels.whatsapp-echoes',
    render: (ctx) => {
      const wake = getWakeAgentsMdScratch(ctx)
      // Echoes only show up on conversation-lane wakes; standalone
      // (operator/heartbeat) wakes don't see CONVERSATION.md.
      if (wake?.lane !== 'conversation') return null
      return whatsappAgentsMd
    },
  }),
]

export const whatsappPlatformHint: HarnessPlatformHint = {
  kind: 'whatsapp',
  hint: [
    '- Medium: WhatsApp customer chat.',
    '- Formatting: plain text only — markdown asterisks/backticks render literally. Use line breaks for structure.',
    '- Cadence: outside the 24-hour session window you can only send pre-approved templates; inside it you can reply freely.',
    '- Attachments: image, document, audio, and video are supported via `send_file`.',
    '- Interactive: `send_card` renders buttons/list pickers; prefer it over asking the customer to type choices.',
  ].join('\n'),
}
