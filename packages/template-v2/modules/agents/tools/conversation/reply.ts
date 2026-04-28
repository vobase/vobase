import { appendTextMessage } from '@modules/messaging/service/messages'
import { type Static, Type } from '@sinclair/typebox'

import { defineAgentTool } from '../shared/define-tool'

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
