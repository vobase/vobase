/**
 * WhatsApp adapter agent surface — AGENTS.md fragment for echo coexistence.
 *
 * When staff send messages via the WhatsApp Business App (SMB coexistence),
 * those messages arrive as echoes with `role='staff', metadata.echo=true`. The
 * agent sees them in `MESSAGES.md` on the next turn's side-load and must stay
 * silent so it doesn't talk over the human staffer.
 *
 * `whatsappAgentsMdContributors` is the canonical export aggregated by the
 * channels umbrella's `agent.ts` (pattern mirrors `messaging/agent.ts`).
 */
import { defineIndexContributor, type HarnessPlatformHint, type IndexContributor } from '@vobase/core'

const AGENTS_MD_FILE = 'AGENTS.md'

export const whatsappAgentsMd = `## WhatsApp coexistence echoes

Some messages with \`role='staff'\` in this conversation may have
\`metadata.echoSource = 'business_app'\` — these were typed by a human staffer in
the WhatsApp Business App, not via Vobase.

Treat them as authoritative staff intent (the staffer chose to handle the
conversation directly). They do not open the 24h messaging window for you, and they
did not wake you — you saw them on this turn's \`MESSAGES.md\` re-render.

**Behavior rule (locked):** when an echo appears in your context, stay silent.
Do NOT post an acknowledgement message, do NOT post an internal note about
standing down, do NOT resolve or reassign the conversation. The staffer is
handling it — your job is to not talk over them. **On this turn, do NOT issue
any of \`reply\` / \`send_card\` / \`send_file\` / \`book_slot\`.** End your turn
cleanly without using a customer-facing tool. Continue normal behavior on the
next wake (a future customer message will wake you, by which time the staffer
will either be done or still handling).
`

export const whatsappAgentsMdContributors: readonly IndexContributor[] = [
  defineIndexContributor({
    file: AGENTS_MD_FILE,
    priority: 55,
    name: 'channels.whatsapp-echoes',
    render: () => whatsappAgentsMd,
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
