import { Type } from '@mariozechner/pi-ai'
import { appendTextMessage } from '@modules/inbox/service/messages'
import type { AgentTool, ToolContext } from '@server/contracts/tool'
import type { ToolResult } from '@server/contracts/tool-result'
import type { Static } from '@sinclair/typebox'
import { Value } from '@sinclair/typebox/value'

export const ReplyInputSchema = Type.Object({
  text: Type.String({ minLength: 1, description: 'The reply text to send to the customer.' }),
  replyToMessageId: Type.Optional(Type.String()),
})

export type ReplyInput = Static<typeof ReplyInputSchema>

function firstError(schema: typeof ReplyInputSchema, value: unknown): string {
  const first = Value.Errors(schema, value).First()
  return first ? `${first.path || 'root'}: ${first.message}` : 'invalid input'
}

export const replyTool: AgentTool<ReplyInput, { messageId: string }> = {
  name: 'reply',
  description: 'Send a plain-text reply to the customer in this conversation.',
  inputSchema: ReplyInputSchema,
  parallelGroup: 'never',

  async execute(args, ctx: ToolContext): Promise<ToolResult<{ messageId: string }>> {
    if (!Value.Check(ReplyInputSchema, args)) {
      return {
        ok: false,
        error: `Invalid reply input — ${firstError(ReplyInputSchema, args)}`,
        errorCode: 'VALIDATION_ERROR',
      }
    }

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

    return { ok: true, content: { messageId: msg.id } }
  },
}
