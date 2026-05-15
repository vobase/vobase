import { sendOutbound, throwIfFailed } from '@modules/channels/service/outbound'
import { DRIVE_STORAGE_BUCKET } from '@modules/drive/constants'
import { filesServiceFor, getDriveStorage } from '@modules/drive/service/files'
import { type Static, Type } from '@sinclair/typebox'
import { defineAgentTool, type OutboundMedia } from '@vobase/core'

import { get as getConversation } from '../service/conversations'
import { appendMediaMessage } from '../service/messages'

const MediaTypeSchema = Type.Union([
  Type.Literal('image'),
  Type.Literal('document'),
  Type.Literal('video'),
  Type.Literal('audio'),
])

export const SendFileInputSchema = Type.Object({
  driveFileId: Type.Optional(Type.String({ minLength: 1 })),
  url: Type.Optional(Type.String({ minLength: 1 })),
  type: Type.Optional(MediaTypeSchema),
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

function mediaTypeForUrl(url: string, explicit: OutboundMedia['type'] | undefined): OutboundMedia['type'] {
  if (explicit) return explicit
  const pathname = (() => {
    try {
      return new URL(url).pathname.toLowerCase()
    } catch {
      return url.toLowerCase()
    }
  })()
  if (/\.(png|jpe?g|gif|webp|bmp|svg)$/u.test(pathname)) return 'image'
  if (/\.(mp4|mov|webm|m4v)$/u.test(pathname)) return 'video'
  if (/\.(mp3|wav|ogg|m4a|aac)$/u.test(pathname)) return 'audio'
  return 'document'
}

export const sendFileTool = defineAgentTool({
  name: 'send_file',
  description:
    'Send a file to the customer — either an artefact from `/drive/` (driveFileId) or a public http(s) URL (url). Requires staff approval if agent.fileApprovalRequired=true.',
  schema: SendFileInputSchema,
  errorCode: 'SEND_FILE_ERROR',
  requiresApproval: true,
  lane: 'conversation',
  prompt:
    "**This is the only tool for image / file delivery — never inline an image or download URL inside a `reply_contact` text reply. `send_file` renders the image inline in the customer's chat client; a URL pasted into a text reply shows as a bare link they have to click.**\n\nPass `driveFileId` for an artefact that lives in `/drive/` (id comes from `cat`-ing or grepping the drive — never fabricate). Pass `url` for a public http(s) link (e.g. a product image on the company website); optionally set `type` (image/document/video/audio) when the extension is ambiguous. Exactly one of `driveFileId` or `url` must be supplied. Captions are optional. If you also need to say something alongside the photo, put it in `caption` — do not split the photo across `send_file` and a separate `reply_contact`.",
  async run(args, ctx) {
    if (!args.driveFileId && !args.url) {
      throw new Error('send_file: either driveFileId or url is required')
    }
    if (args.driveFileId && args.url) {
      throw new Error('send_file: driveFileId and url are mutually exclusive')
    }

    if (args.url) {
      if (!/^https?:\/\//u.test(args.url)) {
        throw new Error('send_file: url must be http(s)')
      }
      const type = mediaTypeForUrl(args.url, args.type)
      const msg = await appendMediaMessage({
        conversationId: ctx.conversationId,
        organizationId: ctx.organizationId,
        agentId: ctx.agentId,
        wakeId: ctx.wakeId,
        turnIndex: ctx.turnIndex,
        toolCallId: ctx.toolCallId,
        url: args.url,
        type,
        caption: args.caption,
      })
      const media: OutboundMedia = { type, url: args.url, caption: args.caption }
      const result = await sendOutbound({
        organizationId: ctx.organizationId,
        conversationId: ctx.conversationId,
        persisted: { id: msg.id },
        toolName: 'send_file',
        payload: { media },
      })
      throwIfFailed(result, 'send_file')
      return { messageId: msg.id }
    }

    const driveFileId = args.driveFileId as string
    const scan = await runThreatScan(driveFileId)
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
      driveFileId,
      caption: args.caption,
    })

    // Resolve the drive row + bytes here so `outbound.ts` stays payload-
    // agnostic. Virtual files (no storageKey) cannot be sent as media.
    const file = await filesServiceFor(ctx.organizationId).get(driveFileId)
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
