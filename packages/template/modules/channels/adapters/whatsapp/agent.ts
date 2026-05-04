/**
 * WhatsApp adapter agent surface — AGENTS.md behavior rule for echo coexistence.
 *
 * When staff send messages via the WhatsApp Business App (SMB coexistence), those
 * messages arrive as echoes with `role='staff', metadata.echo=true`. The agent sees
 * them in messages.md on the next turn's side-load and must stay silent.
 */

export const whatsappAgentsMd = `
## WhatsApp coexistence echoes

Some messages with \`role='staff'\` in this conversation may have
\`metadata.echoSource = 'business_app'\` — these were typed by a human staffer in
the WhatsApp Business App, not via Vobase.

Treat them as authoritative staff intent (the staffer chose to handle the
conversation directly). They do not open the 24h messaging window for you, and they
did not wake you — you saw them on this turn's \`messages.md\` re-render.

**Behavior rule (locked):** when an echo appears in your context, stay silent.
Do NOT post an acknowledgement message, do NOT post an internal note about
standing down, do NOT resolve or reassign the conversation. The staffer is
handling it — your job is to not talk over them. **On this turn, do NOT issue
any of \`reply\` / \`send_card\` / \`send_file\` / \`book_slot\`.** End your turn
cleanly without using a customer-facing tool. Continue normal behavior on the
next wake (a future customer message will wake you, by which time the staffer
will either be done or still handling).
`
