import { sendOutbound, throwIfFailed } from '@modules/channels/service/outbound'
import { DRIVE_STORAGE_BUCKET } from '@modules/drive/constants'
import { filesServiceFor, getDriveStorage } from '@modules/drive/service/files'
import { type Static, Type } from '@sinclair/typebox'
import { defineAgentTool, type OutboundMedia } from '@vobase/core'

import { get as getConversation } from '../service/conversations'
import { appendMediaMessage } from '../service/messages'

export const SendFileInputSchema = Type.Object({
  driveFileId: Type.String({ minLength: 1 }),
  caption: Type.Optional(Type.String()),
})

export type SendFileInput = Static<typeof SendFileInputSchema>

/** Phase 2 stub — always passes. Real hermes threat-scan patterns land in Phase 2.5+. */
// biome-ignore lint/suspicious/useAwait: contract requires async signature
async function runThreatScan(_driveFileId: string): Promise<{ ok: boolean }> {
  return { ok: true }
}

function mediaTypeFor(mime: string | null | undefined): OutboundMedia['type'] {
  const m = (mime ?? '').toLowerCase()
  if (m.startsWith('image/')) return 'image'
  if (m.startsWith('video/')) return 'video'
  if (m.startsWith('audio/')) return 'audio'
  return 'document'
}

export const sendFileTool = defineAgentTool({
  name: 'send_file',
  description: 'Send a drive file to the customer. Requires staff approval if agent.fileApprovalRequired=true.',
  schema: SendFileInputSchema,
  errorCode: 'SEND_FILE_ERROR',
  requiresApproval: true,
  audience: 'customer',
  lane: 'conversation',
  prompt:
    "Use when the customer needs an artefact (PDF, image, doc) that already exists in `/drive/`. The drive file id comes from `cat`-ing the file or grepping the drive listing — never fabricate ids. Captions are optional but help the customer understand what they're receiving.",
  async run(args, ctx) {
    const scan = await runThreatScan(args.driveFileId)
    if (!scan.ok) {
      throw new Error('File failed threat scan')
    }
    const msg = await appendMediaMessage({
      conversationId: ctx.conversationId,
      organizationId: ctx.organizationId,
      agentId: ctx.agentId,
      wakeId: ctx.wakeId,
      turnIndex: ctx.turnIndex,
      toolCallId: ctx.toolCallId,
      driveFileId: args.driveFileId,
      caption: args.caption,
    })

    // Resolve the drive row + bytes here so `outbound.ts` stays payload-
    // agnostic. Virtual files (no storageKey) cannot be sent as media.
    const file = await filesServiceFor(ctx.organizationId).get(args.driveFileId)
    if (!file) throw new Error('Drive file not found')
    if (!file.storageKey) throw new Error('Cannot send virtual drive file as media')

    // Within-tenant scope check: an agent serving contact-X must not be able
    // to leak contact-Y's private upload (same org, different conversation).
    // Allow `organization`-scope (shared KB), `contact`-scope iff the file's
    // contact matches this conversation's contact, and `agent`-scope iff the
    // file belongs to this agent.
    const conv = await getConversation(ctx.conversationId)
    const allowed =
      file.scope === 'organization' ||
      (file.scope === 'contact' && file.scopeId === conv.contactId) ||
      (file.scope === 'agent' && file.scopeId === ctx.agentId)
    if (!allowed) {
      throw new Error(
        `send_file: drive file ${file.id} (scope ${file.scope}/${file.scopeId}) not sendable to this conversation`,
      )
    }
    const storage = getDriveStorage()
    if (!storage) throw new Error('Drive storage not installed — cannot send file')
    const bytes = await storage.bucket(DRIVE_STORAGE_BUCKET).download(file.storageKey)

    const media: OutboundMedia = {
      type: mediaTypeFor(file.mimeType),
      data: Buffer.from(bytes),
      filename: file.name ?? file.originalName ?? undefined,
      caption: args.caption,
      mimeType: file.mimeType ?? undefined,
    }

    const result = await sendOutbound({
      organizationId: ctx.organizationId,
      conversationId: ctx.conversationId,
      persisted: { id: msg.id },
      toolName: 'send_file',
      payload: { media },
    })
    throwIfFailed(result, 'send_file')
    return { messageId: msg.id }
  },
})
