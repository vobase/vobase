/**
 * Staff-reply writer — one-write-path discipline.
 * Inserts a staff message + journals tool_execution_end atomically.
 * Does NOT invoke bootWake or any agent re-run path.
 */
import type { Message } from '@server/contracts/domain-types'
import { appendStaffTextMessage } from './messages'

export interface SendStaffReplyInput {
  conversationId: string
  organizationId: string
  staffUserId: string
  body: string
}

export async function sendStaffReply(input: SendStaffReplyInput): Promise<{ messageId: string; message: Message }> {
  const message = await appendStaffTextMessage({
    conversationId: input.conversationId,
    organizationId: input.organizationId,
    staffUserId: input.staffUserId,
    body: input.body,
  })
  return { messageId: message.id, message }
}
