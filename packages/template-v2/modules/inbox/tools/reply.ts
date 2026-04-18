import { appendTextMessage } from '@modules/inbox/service/messages'
import type { AgentTool, ToolContext } from '@server/contracts/tool'
import type { ToolResult } from '@server/contracts/tool-result'
import { z } from 'zod'

const ReplyInputSchema = z.object({
  text: z.string().min(1, 'text must not be empty'),
  replyToMessageId: z.string().optional(),
})

export type ReplyInput = z.infer<typeof ReplyInputSchema>

export const replyTool: AgentTool<ReplyInput, { messageId: string }> = {
  name: 'reply',
  description: 'Send a plain-text reply to the customer in this conversation.',
  inputSchema: ReplyInputSchema,

  async execute(args, ctx: ToolContext): Promise<ToolResult<{ messageId: string }>> {
    const parsed = ReplyInputSchema.safeParse(args)
    if (!parsed.success) {
      return { ok: false, error: 'Invalid reply input', errorCode: 'VALIDATION_ERROR', details: parsed.error.issues }
    }

    const msg = await appendTextMessage({
      conversationId: ctx.conversationId,
      tenantId: ctx.tenantId,
      agentId: ctx.agentId,
      wakeId: ctx.wakeId,
      turnIndex: ctx.turnIndex,
      toolCallId: ctx.toolCallId,
      text: parsed.data.text,
      replyToMessageId: parsed.data.replyToMessageId,
    })

    return { ok: true, content: { messageId: msg.id } }
  },
}
