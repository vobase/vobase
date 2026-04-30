/**
 * Staff-reply writer — one-write-path discipline.
 * Inserts a staff message + journals tool_execution_end atomically.
 * Does NOT invoke bootWake or any agent re-run path.
 *
 * Prepends `[staff display name] ` to the customer-visible body so the
 * recipient can tell which teammate replied. If the body already starts with
 * a bracketed prefix or the staff profile can't be resolved, the body is left
 * unchanged.
 */
import { find as findStaff } from '@modules/team/service/staff'

import type { Message } from '../schema'
import { appendStaffTextMessage } from './messages'

export interface SendStaffReplyInput {
  conversationId: string
  organizationId: string
  staffUserId: string
  body: string
}

function hasBracketedPrefix(body: string): boolean {
  return /^\s*\[[^\]\n]+\]/.test(body)
}

async function prefixWithStaffName(staffUserId: string, body: string): Promise<string> {
  if (hasBracketedPrefix(body)) return body
  try {
    const staff = await findStaff(staffUserId)
    const name = staff?.displayName?.trim()
    return name ? `[${name}] ${body}` : body
  } catch {
    return body
  }
}

export async function sendStaffReply(input: SendStaffReplyInput): Promise<{ messageId: string; message: Message }> {
  const body = await prefixWithStaffName(input.staffUserId, input.body)
  const message = await appendStaffTextMessage({
    conversationId: input.conversationId,
    organizationId: input.organizationId,
    staffUserId: input.staffUserId,
    body,
  })
  return { messageId: message.id, message }
}
