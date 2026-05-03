/**
 * Staff-reply writer — one-write-path discipline.
 * Inserts a staff message + journals tool_execution_end atomically.
 * Does NOT invoke bootWake or any agent re-run path.
 *
 * Prepends `[staff display name] ` to the customer-visible body so the
 * recipient can tell which teammate replied. If the body already starts with
 * a bracketed prefix or the staff profile can't be resolved, the body is left
 * unchanged.
 *
 * Attachments — when staff replies carry binary attachments, the bytes are
 * pre-ingested through the same `filesService.ingestUpload` seam used by
 * inbound (Step 12 / Principle 8). Failures warn-log + drop the offending
 * attachment; the message still posts. There is no idempotency check on
 * this path because staff replies have no `channelExternalId`.
 */

import { filesServiceFor } from '@modules/drive/service/files'
import type { MessageAttachmentRef } from '@modules/drive/service/types'
import { find as findStaff } from '@modules/team/service/staff'

import type { Message } from '../schema'
import { get as getConversation } from './conversations'
import { appendStaffTextMessage } from './messages'

export interface SendStaffReplyInput {
  conversationId: string
  organizationId: string
  staffUserId: string
  body: string
  /** Optional bytes-bearing attachments — see `CreateInboundMessageInput.attachments`. */
  attachments?: Array<{
    bytes: Buffer
    name: string
    mimeType: string
    sizeBytes: number
  }>
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

  const attachmentRefs: MessageAttachmentRef[] = []
  if (input.attachments && input.attachments.length > 0) {
    const conv = await getConversation(input.conversationId)
    const drive = filesServiceFor(input.organizationId)
    for (const att of input.attachments) {
      try {
        const ingest = await drive.ingestUpload({
          organizationId: input.organizationId,
          scope: { scope: 'contact', contactId: conv.contactId },
          originalName: att.name,
          mimeType: att.mimeType,
          sizeBytes: att.sizeBytes,
          bytes: att.bytes,
          source: 'staff_uploaded',
          uploadedBy: input.staffUserId,
          basePath: `/contacts/${conv.contactId}/${conv.channelInstanceId}/attachments/`,
        })
        attachmentRefs.push({
          driveFileId: ingest.id,
          path: ingest.path,
          mimeType: att.mimeType,
          sizeBytes: att.sizeBytes,
          name: att.name,
          caption: null,
          extractionKind: ingest.extractionKind,
        })
      } catch (err) {
        console.warn('[messaging:staff-reply] attachment ingest failed; omitting', {
          conversationId: input.conversationId,
          name: att.name,
          err: err instanceof Error ? err.message : String(err),
        })
      }
    }
  }

  const message = await appendStaffTextMessage({
    conversationId: input.conversationId,
    organizationId: input.organizationId,
    staffUserId: input.staffUserId,
    body,
    attachments: attachmentRefs.length > 0 ? attachmentRefs : undefined,
  })
  return { messageId: message.id, message }
}
