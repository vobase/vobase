import { sendOutbound, throwIfFailed } from '@modules/channels/service/outbound'
import { type Static, Type } from '@sinclair/typebox'
import { defineAgentTool } from '@vobase/core'

import { appendTextMessage } from '../service/messages'

export const ReplyContactInputSchema = Type.Object({
  text: Type.String({ minLength: 1, description: 'The reply text to send to the customer.' }),
  replyToMessageId: Type.Optional(Type.String()),
})

export type ReplyContactInput = Static<typeof ReplyContactInputSchema>

export const replyContactTool = defineAgentTool({
  name: 'reply_contact',
  description: 'Send a plain-text reply to the customer in this conversation.',
  schema: ReplyContactInputSchema,
  errorCode: 'REPLY_ERROR',
  lane: 'conversation',
  prompt:
    'Send a plain-text customer-facing reply (2–4 short sentences). Use for pure acknowledgements, free-form questions back to the customer, or single-sentence factual answers with no CTA. Reach for `send_card` instead when the response has structure or actionable choices, and `send_file` whenever the customer needs an image / file / download (including a public image URL — `send_file({url})` renders inline; a URL pasted in this tool\'s text shows as a bare link). Talk to staff with `consult_staff`, not this tool. Only call when a customer message is pending and unanswered — never to react to an internal note, staff coaching, or your own prior wake. Before firing, scan "Your recent actions" in the wake cue: if you already sent the same factual content to the customer, do not re-fire (paraphrasing a few words to bypass this check is still a duplicate).\n\nNEVER cite or quote internal artifact paths in the customer reply. The customer cannot see `/drive/...`, `/contacts/...`, `/agents/...`, `/staff/...`, `MEMORY.md`, `INTERNAL-NOTES.md`, `BUSINESS.md`, or any other workspace path. Do not surface filenames or `#anchors` as provenance — paraphrase the substance instead. Keep ids (wakeId, agentId, contactId, proposalId, etc.) out of customer replies entirely.',
  async run(args, ctx) {
    const msg = await appendTextMessage({
      conversationId: ctx.conversationId,
      organizationId: ctx.organizationId,
      agentId: ctx.agentId,
      wakeId: ctx.wakeId,
      turnIndex: ctx.turnIndex,
      toolCallId: ctx.toolCallId,
      text: args.text,
      replyToMessageId: args.replyToMessageId,
    })
    const result = await sendOutbound({
      organizationId: ctx.organizationId,
      conversationId: ctx.conversationId,
      persisted: { id: msg.id },
      toolName: 'reply_contact',
      payload: { text: args.text, replyToMessageId: args.replyToMessageId },
    })
    throwIfFailed(result, 'reply_contact')
    return { messageId: msg.id }
  },
})
