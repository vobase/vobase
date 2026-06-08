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
 *
 * Post-commit learning signal (Slice 2): after a genuine staff reply, if the
 * conversation is currently assigned to an agent, a `staff_takeover` signal
 * is emitted to `learning:triage` (fire-and-forget, non-fatal). The scheduler
 * is optional — when not installed the enqueue is silently skipped.
 */

import { sendOutbound, throwIfFailed } from '@modules/channels/service/outbound'
import { filesServiceFor } from '@modules/drive/service/files'
import type { MessageAttachmentRef } from '@modules/drive/service/types'
import { find as findStaff } from '@modules/team/service/staff'

import { isAutoTriageEnabled } from '~/wake/learning/auto-triage'
import { LEARNING_TRIAGE_JOB, type LearningTriageJobPayload } from '~/wake/learning/triage-job'
import { hasStaffPrefix } from '../lib/staff-prefix'
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

/**
 * Narrow port: publishes one learning-triage job per call. Decoupled from
 * concrete pg-boss so staff-reply.ts stays test-friendly. Wired in
 * `modules/messaging/module.ts::init`.
 */
export interface StaffReplyTriageScheduler {
  publish(name: string, payload: LearningTriageJobPayload): Promise<void>
}

let _triageScheduler: StaffReplyTriageScheduler | null = null

export function installStaffReplyTriageScheduler(svc: StaffReplyTriageScheduler): void {
  _triageScheduler = svc
}

export function __resetStaffReplyTriageSchedulerForTests(): void {
  _triageScheduler = null
}

async function prefixWithStaffName(staffUserId: string, body: string): Promise<string> {
  if (hasStaffPrefix(body)) return body
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

  // Resolve conversation once — used by both attachments path and triage enqueue.
  const conv = await getConversation(input.conversationId)

  const attachmentRefs: MessageAttachmentRef[] = []
  if (input.attachments && input.attachments.length > 0) {
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
  const result = await sendOutbound({
    organizationId: input.organizationId,
    conversationId: input.conversationId,
    persisted: { id: message.id },
    toolName: 'staff_reply',
    payload: { text: body },
  })
  throwIfFailed(result, 'staff_reply')

  // Post-commit learning signal — fire-and-forget, non-fatal.
  // Auto-triage kill-switch (opt-out): skip automatic staff-takeover triage when disabled.
  if (_triageScheduler && isAutoTriageEnabled()) {
    const assigneeAgentId = conv.assignee.startsWith('agent:') ? conv.assignee.slice('agent:'.length) : null
    if (assigneeAgentId) {
      const scheduler = _triageScheduler
      void Promise.resolve()
        .then(() =>
          scheduler.publish(LEARNING_TRIAGE_JOB, {
            organizationId: input.organizationId,
            agentId: assigneeAgentId,
            conversationId: input.conversationId,
            signal: { kind: 'staff_takeover', messageId: message.id, body: input.body },
          }),
        )
        .catch((err) => {
          console.warn('[staff-reply] triage enqueue failed:', err)
        })
    }
  }

  return { messageId: message.id, message }
}
