/**
 * Web adapter agent surface — declarative platform hint surfaced in the
 * frozen system prompt. Co-located with the adapter so adding a new channel
 * adapter only touches its own folder (umbrella convention from CLAUDE.md).
 */
import type { HarnessPlatformHint } from '@vobase/core'

export const webPlatformHint: HarnessPlatformHint = {
  kind: 'web',
  hint: [
    '- Medium: web chat widget.',
    '- Formatting: markdown is rendered (bold, lists, links, code blocks).',
    '- Cadence: customers expect near-instant replies; keep messages short.',
    '- Attachments: image + file uploads are supported via `send_file`.',
  ].join('\n'),
}
