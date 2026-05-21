import { sendOutbound, throwIfFailed } from '@modules/channels/service/outbound'
import { DRIVE_STORAGE_BUCKET } from '@modules/drive/constants'
import { mediaKindFromMime, mediaKindFromUrlExt } from '@modules/drive/lib/format'
import { type FilesService, filesServiceFor, getDriveStorage } from '@modules/drive/service/files'
import type { DriveScope } from '@modules/drive/service/types'
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

/**
 * Build a "did you mean" listing when `send_file` can't resolve a drive file.
 * Lists recent attachments under this conversation's contact scope plus a hint
 * at the org-drive root. A bare "Drive file not found" makes the agent burn
 * turns retrying with hallucinated ids — this gives it real candidates.
 */
async function describeAvailableFiles(drive: FilesService, contactId: string | null): Promise<string> {
  // Listings are advisory — never fail the tool because the hint couldn't render.
  const safeList = (scope: DriveScope) => drive.listFolder(scope, null).catch(() => [])
  const [contactRoots, orgRoots] = await Promise.all([
    contactId ? safeList({ scope: 'contact', contactId }) : Promise.resolve([]),
    safeList({ scope: 'organization' }),
  ])
  const topPaths = (rows: Awaited<ReturnType<FilesService['listFolder']>>) =>
    rows
      .map((r) => r.path)
      .filter((p): p is string => typeof p === 'string')
      .slice(0, 6)
  const lines: string[] = []
  const contactPaths = topPaths(contactRoots)
  if (contactPaths.length > 0) lines.push(`Recent contact-scope folders: ${contactPaths.join(', ')}`)
  const orgPaths = topPaths(orgRoots)
  if (orgPaths.length > 0) lines.push(`Recent org-drive paths: ${orgPaths.join(', ')}`)
  return lines.join(' ')
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
      const type: OutboundMedia['type'] = args.type ?? mediaKindFromUrlExt(args.url) ?? 'document'
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
    // Resolve the drive row + bytes here so `outbound.ts` stays payload-
    // agnostic. Virtual files (no storageKey) cannot be sent as media.
    const drive = filesServiceFor(ctx.organizationId)
    const file = await drive.get(driveFileId)
    if (!file) {
      const conv = await getConversation(ctx.conversationId).catch(() => null)
      const candidates = await describeAvailableFiles(drive, conv?.contactId ?? null)
      const suffix = candidates ? ` ${candidates}` : ''
      throw new Error(`Drive file not found: ${driveFileId}.${suffix}`)
    }
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

    const mediaType = mediaKindFromMime(file.mimeType) ?? 'document'

    // All validation passed — only NOW persist the placeholder and dispatch.
    const msg = await appendMediaMessage({
      conversationId: ctx.conversationId,
      organizationId: ctx.organizationId,
      agentId: ctx.agentId,
      wakeId: ctx.wakeId,
      turnIndex: ctx.turnIndex,
      toolCallId: ctx.toolCallId,
      driveFileId,
      type: mediaType,
      caption: args.caption,
    })

    // WhatsApp Cloud API only accepts `filename` on `document`-typed media;
    // passing it on image/video/audio makes Meta reject the whole send.
    const filename = mediaType === 'document' ? (file.name ?? file.originalName ?? undefined) : undefined
    const media: OutboundMedia = {
      type: mediaType,
      data: Buffer.from(bytes),
      filename,
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
