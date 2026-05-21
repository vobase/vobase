import { sendOutbound, throwIfFailed } from '@modules/channels/service/outbound'
import { DRIVE_STORAGE_BUCKET } from '@modules/drive/constants'
import { mediaKindFromMime, mediaKindFromUrlExt } from '@modules/drive/lib/format'
import type { DriveFile } from '@modules/drive/schema'
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
 * `Accept` header per media type for the url-form server-side fetch. Excludes
 * `image/webp` so Cloudflare-fronted product CDNs don't auto-negotiate to a
 * mime WhatsApp won't accept. Wildcard for document because Meta accepts all
 * common doc mimes.
 */
const ACCEPT_BY_TYPE: Record<OutboundMedia['type'], string> = {
  image: 'image/jpeg,image/png',
  video: 'video/mp4,video/3gpp',
  audio: 'audio/aac,audio/mp4,audio/mpeg,audio/amr,audio/ogg,audio/opus',
  document: '*/*',
}

/** WhatsApp Cloud API per-type size ceilings. */
const MAX_BYTES_BY_TYPE: Record<OutboundMedia['type'], number> = {
  image: 5 * 1024 * 1024,
  video: 16 * 1024 * 1024,
  audio: 16 * 1024 * 1024,
  document: 100 * 1024 * 1024,
}

function filenameFromUrl(url: string): string | undefined {
  try {
    const last = new URL(url).pathname.split('/').filter(Boolean).pop()
    return last ? decodeURIComponent(last) : undefined
  } catch {
    return undefined
  }
}

/**
 * Resolve the bash-view path the agent sees (e.g. `/drive/menu.pdf` or
 * `/contacts/<id>/drive/contract.md`) to `(scope, dbPath)` for
 * `FilesService.getByPath`. Returns null if the path is not a known
 * media-eligible mount — the caller surfaces "Drive file not found" so the
 * LLM gets the same opaque outcome whether the path is wrong or the file is
 * missing. Agent-scope is intentionally excluded: agents don't have binary
 * artefacts of their own to send as media.
 */
function parseDriveBashPath(p: string): { scope: DriveScope; dbPath: string } | null {
  if (p.startsWith('/drive/')) {
    return { scope: { scope: 'organization' }, dbPath: p.slice('/drive'.length) }
  }
  const contactMatch = p.match(/^\/contacts\/([^/]+)\/drive(\/.+)$/u)
  if (contactMatch) {
    return { scope: { scope: 'contact', contactId: contactMatch[1] }, dbPath: contactMatch[2] }
  }
  return null
}

/**
 * Look up the file by id OR by bash-view path. Path-form (starts with `/`) is
 * how the LLM naturally references files — it `cat`s `/drive/foo.mp4` and has
 * no way to discover the database id from the workspace. Both shapes resolve
 * through one seam so downstream handling stays uniform.
 */
async function resolveDriveFile(drive: FilesService, idOrPath: string): Promise<DriveFile | null> {
  if (idOrPath.startsWith('/')) {
    const parsed = parseDriveBashPath(idOrPath)
    if (!parsed) return null
    return drive.getByPath(parsed.scope, parsed.dbPath)
  }
  return drive.get(idOrPath)
}

/**
 * Build a "did you mean" listing when `send_file` can't resolve a path. Lists
 * recent attachments under this conversation's contact scope plus a hint at
 * the org-drive root. The agent burned 4 turns + ~$0.3 in a real conversation
 * retrying with hallucinated paths because the failure message was just
 * "Drive file not found" — this gives it the candidates it needs.
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
  if (orgPaths.length > 0) {
    lines.push(`Recent org-drive paths (use the \`/drive\` prefix in send_file): ${orgPaths.join(', ')}`)
  }
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
    "**This is the only tool for image / file delivery — never inline an image or download URL inside a `reply_contact` text reply. `send_file` renders the image inline in the customer's chat client; a URL pasted into a text reply shows as a bare link they have to click.**\n\nPass `driveFileId` for an artefact that lives in the drive: either the bash-view path you `cat`'d (e.g. `/drive/menu.pdf`, `/contacts/<contactId>/drive/contract.md`) OR the database id when you have it. **Do not fabricate a filename as the id — use the full leading-`/` path.** Pass `url` for a public http(s) link (e.g. a product image on the company website); optionally set `type` (image/document/video/audio) when the extension is ambiguous. Exactly one of `driveFileId` or `url` must be supplied. Captions are optional — if you also need to say something alongside the photo, put it in `caption`, do NOT split the photo across `send_file` and a separate `reply_contact`. If `send_file` returns `{ok:false}` no message was created and nothing was sent — recover with a single `reply_contact` apology; never claim a file was sent until this tool returns `{ok:true}`.",
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

      // Fetch the bytes ourselves and ship them to Meta as a multipart upload
      // rather than handing Meta a `link` and letting them refetch. Meta's
      // refetch does its own content negotiation, and CDNs (notably
      // Cloudflare) happily return `image/webp` for a `.jpg` URL — which
      // WhatsApp Cloud API silently rejects, so the API call succeeds but the
      // customer never sees the image. By fetching with an `Accept` header
      // that excludes webp we force the CDN to serve a Meta-compatible mime.
      const accept = ACCEPT_BY_TYPE[type]
      const res = await fetch(args.url, { headers: { Accept: accept }, redirect: 'follow' })
      if (!res.ok) {
        throw new Error(`send_file: failed to fetch url (${res.status} ${res.statusText})`)
      }
      const responseMime = (res.headers.get('content-type') ?? 'application/octet-stream').split(';')[0].trim()
      let bytes: Uint8Array = new Uint8Array(await res.arrayBuffer())
      let mimeType = responseMime

      // WhatsApp images must be image/jpeg or image/png. CDNs (Cloudflare
      // Polish, in particular) sometimes return image/webp even when the
      // Accept header explicitly excludes it — the `vary: Accept` header is
      // a lie when the CDN's image policy overrides client preference. When
      // we see a non-allowed image mime, transcode to JPEG with sharp.
      if (type === 'image' && !/^image\/(jpe?g|png)$/u.test(mimeType)) {
        try {
          bytes = await new Bun.Image(bytes).jpeg({ quality: 88 }).bytes()
          mimeType = 'image/jpeg'
        } catch (err) {
          throw new Error(
            `send_file: url returned ${responseMime} and transcode to jpeg failed: ${err instanceof Error ? err.message : String(err)}`,
          )
        }
      }
      const maxBytes = MAX_BYTES_BY_TYPE[type]
      if (bytes.length > maxBytes) {
        throw new Error(`send_file: ${type} payload ${bytes.length}B exceeds WhatsApp limit (${maxBytes}B)`)
      }
      const filename = filenameFromUrl(args.url)

      // All validation passed — persist the placeholder, then dispatch.
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
      const media: OutboundMedia = {
        type,
        data: Buffer.from(bytes),
        ...(type === 'document' && filename ? { filename } : {}),
        caption: args.caption,
        mimeType,
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
    }

    const driveFileIdOrPath = args.driveFileId as string

    // Resolve + validate the drive file BEFORE persisting any message. The
    // previous order created the `kind='image'` row first, so a wrong id /
    // missing file / scope violation left an orphan placeholder in the staff
    // inbox even though `sendOutbound` never ran (WhatsApp got nothing, but
    // the inbox showed `[image]` followed by whatever apology the LLM emitted
    // on the failure — confusing for staff and customers alike).
    const drive = filesServiceFor(ctx.organizationId)
    const file = await resolveDriveFile(drive, driveFileIdOrPath)
    if (!file) {
      const conv = await getConversation(ctx.conversationId).catch(() => null)
      const candidates = await describeAvailableFiles(drive, conv?.contactId ?? null)
      const hint = driveFileIdOrPath.startsWith('/')
        ? ` Path lookup expects bash-view (e.g. \`/drive/menu.pdf\` for org files or \`/contacts/<contactId>/drive/<file>\` for contact files); the wake cue lists inbound attachment paths verbatim — copy them, do not invent.`
        : ''
      const suffix = candidates ? ` ${candidates}` : ''
      throw new Error(`Drive file not found at ${driveFileIdOrPath}.${hint}${suffix}`)
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

    const scan = await runThreatScan(file.id)
    if (!scan.ok) {
      throw new Error('File failed threat scan')
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
      driveFileId: file.id,
      type: mediaType,
      caption: args.caption,
    })

    // Only `document` accepts `filename` on Meta's WhatsApp Cloud API; for
    // image / video / audio Meta returns "Unexpected key \"filename\" on
    // param \"<type>\"" and rejects the whole send. The upstream
    // `@vobase/core` WhatsApp adapter forwards `filename` unconditionally
    // (adapter.ts:486-488), so guard it here.
    const filename = mediaType === 'document' ? (file.name ?? file.originalName ?? undefined) : undefined
    const media: OutboundMedia = {
      type: mediaType,
      data: Buffer.from(bytes),
      ...(filename ? { filename } : {}),
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
