import { type Static, Type } from '@sinclair/typebox'
import { defineAgentTool } from '@vobase/core'

import { appendTextMessage } from '../service/messages'

export const ReplyInputSchema = Type.Object({
  text: Type.String({ minLength: 1, description: 'The reply text to send to the customer.' }),
  replyToMessageId: Type.Optional(Type.String()),
})

export type ReplyInput = Static<typeof ReplyInputSchema>

export const replyTool = defineAgentTool({
  name: 'reply',
  description: 'Send a plain-text reply to the customer in this conversation.',
  schema: ReplyInputSchema,
  errorCode: 'REPLY_ERROR',
  audience: 'customer',
  lane: 'conversation',
  prompt:
    'Use only for pure acknowledgements, free-form questions back to the customer, and single-sentence factual answers with no CTA. PREFER `send_card` whenever the reply has any structure or actionable choices (pricing, plans, refund confirmations, yes/no with consequences, 2+ options, next-step CTAs). Keep prose to 2–4 short sentences.',
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
    return { messageId: msg.id }
  },
})
