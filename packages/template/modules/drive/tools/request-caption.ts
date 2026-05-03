/**
 * `request_caption` — drive-owned agent tool that asks the harness to
 * caption / OCR a binary-stub file and re-wake the conversation when the
 * extraction completes.
 *
 * Lives under `modules/drive/tools/` per the template's "tools colocated
 * with the service owning the side-effect" rule (CLAUDE.md, Tools section).
 * The drive `agent.ts` re-exports it in its `tools` array.
 *
 * Lane: `'conversation'` — standalone wakes have no `conversationId` to
 * re-wake.
 *
 * Audience: `'internal'` — never sent to the customer; allowed on
 * supervisor-coaching wakes too.
 *
 * Wake mechanism: producer-side, the drive job enqueues
 * `INBOUND_TO_WAKE_JOB` with `{ trigger: 'caption_ready', conversationId,
 * fileId }`. The wake-side `WakeTrigger` union is widened to recognise
 * the new variant in Commit 2 / Step 11a; in this commit producers emit
 * the variant as a record and the wake handler ignores unknown triggers
 * gracefully (defaults to `inbound_message`).
 */

import { get as getConversation } from '@modules/messaging/service/conversations'
import { type Static, Type } from '@sinclair/typebox'
import { defineAgentTool } from '@vobase/core'

import { filesServiceFor } from '../service/files'

export const RequestCaptionInputSchema = Type.Object({
  path: Type.String({ minLength: 1 }),
})

export type RequestCaptionInput = Static<typeof RequestCaptionInputSchema>

const TOOL_PROMPT = [
  'Fire-and-forget. The caption is NOT in the workspace yet — it surfaces in messages.md',
  'on a NEW wake that fires when extraction completes. After this tool returns:',
  '  1. Acknowledge the request in your turn output if appropriate.',
  '  2. End your turn. Do NOT re-read the file in this wake — it has not changed.',
  "  3. The next wake's first-user-turn cue tells you the caption is ready and points",
  '     you back at messages.md.',
].join('\n')

export const requestCaptionTool = defineAgentTool({
  name: 'request_caption',
  description:
    'Ask the runtime to caption / OCR a binary file in the drive. Returns immediately; the caption surfaces on the next wake (~30s).',
  schema: RequestCaptionInputSchema,
  errorCode: 'REQUEST_CAPTION_ERROR',
  audience: 'internal',
  lane: 'conversation',
  prompt: TOOL_PROMPT,
  async run(args, ctx) {
    const conversationId = ctx.conversationId
    if (!conversationId) {
      throw new Error('request_caption requires a conversation-lane wake')
    }
    const svc = filesServiceFor(ctx.organizationId)

    // The agent's drive scope is contact-scoped for inbound attachments.
    // The conversation row carries `contactId`, which doubles as the
    // `scope: 'contact'` discriminator and the wake-payload field below.
    const conv = await getConversation(conversationId)
    const contactId = conv.contactId
    const file = await svc.getByPath({ scope: 'contact', contactId }, args.path)
    if (!file) {
      throw new Error(`drive file not found: ${args.path}`)
    }

    const result = await svc.requestCaption({
      fileId: file.id,
      conversationId,
      contactId,
      organizationId: ctx.organizationId,
    })
    if (!result.ok) {
      // Surface the service-layer error verbatim so the agent can fall
      // back to `send_file` if the file is too large for caption.
      const detail =
        'sizeBytes' in result && result.sizeBytes !== undefined
          ? ` (sizeBytes=${result.sizeBytes}, maxBytes=${result.maxBytes ?? 'n/a'})`
          : ''
      throw new Error(`${result.error}${detail}`)
    }
    return { accepted: result.accepted, eta_ms: result.eta_ms }
  },
})
