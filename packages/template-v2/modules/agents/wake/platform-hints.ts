import type { HarnessPlatformHint } from '@vobase/core'

/**
 * Channel-specific authoring guidance surfaced in the frozen system prompt.
 *
 * Each entry is rendered verbatim under `## Platform hints`. Keep hints
 * concise — the agent reads them once per wake at prompt construction time.
 */
const PLATFORM_HINTS: Readonly<Record<string, string>> = {
  web: [
    '- Medium: web chat widget.',
    '- Formatting: markdown is rendered (bold, lists, links, code blocks).',
    '- Cadence: customers expect near-instant replies; keep messages short.',
    '- Attachments: image + file uploads are supported via `send_file`.',
  ].join('\n'),
  whatsapp: [
    '- Medium: WhatsApp customer chat.',
    '- Formatting: plain text only — markdown asterisks/backticks render literally. Use line breaks for structure.',
    '- Cadence: outside the 24-hour session window you can only send pre-approved templates; inside it you can reply freely.',
    '- Attachments: image, document, audio, and video are supported via `send_file`.',
    '- Interactive: `send_card` renders buttons/list pickers; prefer it over asking the customer to type choices.',
  ].join('\n'),
  email: [
    '- Medium: email thread.',
    '- Formatting: structured paragraphs, no markdown. Use quoted-reply conventions when referencing prior context.',
    '- Cadence: replies are not real-time; write a single complete response rather than short back-and-forth.',
    '- Subject lines: preserved from the thread root — do not invent a new one.',
  ].join('\n'),
  sms: [
    '- Medium: SMS.',
    '- Formatting: plain text only, ~1600 character ceiling. Avoid links if not essential; they cost characters and can look like spam.',
    '- Cadence: one concise message; split only when unavoidable.',
  ].join('\n'),
  voice: [
    '- Medium: voice (spoken).',
    '- Formatting: short conversational sentences; no markdown, no URLs, no lists. Confirm before acting on destructive or ambiguous requests.',
    '- Cadence: one thought per turn.',
  ].join('\n'),
}

/**
 * Resolve a channel kind to its `HarnessPlatformHint`. Unknown kinds return
 * `undefined` so the frozen-prompt builder renders the "no guidance" fallback.
 */
export function resolvePlatformHint(kind: string | null | undefined): HarnessPlatformHint | undefined {
  if (!kind) return undefined
  const hint = PLATFORM_HINTS[kind]
  if (!hint) return undefined
  return { kind, hint }
}
