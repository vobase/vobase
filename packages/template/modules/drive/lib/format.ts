/**
 * Pure formatting / classification helpers for drive-resident media. Shared
 * by server callers (`send_file` tool, wake-cue renderer) and the frontend
 * message bubble — keep this file free of server-only imports so the
 * `check:bundle` rule is satisfied.
 *
 * `MediaKind` mirrors `OutboundMedia['type']` from `@vobase/core` so the
 * persisted `content.type`, the WhatsApp adapter input, and the React
 * renderer all speak the same vocabulary.
 */

import type { OutboundMedia } from '@vobase/core'

export type MediaKind = OutboundMedia['type']

/**
 * MIME → media kind. `null` when the input is empty (caller picks a default).
 * `'document'` for anything that doesn't match an image/video/audio prefix —
 * matches the WhatsApp Cloud API's "everything else goes as document" model.
 */
export function mediaKindFromMime(mime: string | null | undefined): MediaKind | null {
  const m = (mime ?? '').toLowerCase()
  if (m.startsWith('image/')) return 'image'
  if (m.startsWith('video/')) return 'video'
  if (m.startsWith('audio/')) return 'audio'
  if (m.length > 0) return 'document'
  return null
}

/**
 * URL extension → media kind. `null` when the extension is unfamiliar. The
 * regex set matches what WhatsApp Cloud API actually accepts; deliberately
 * tighter than a generic mime guess so `send_file` doesn't ship a `.heic`
 * as `image` and have Meta reject it.
 */
export function mediaKindFromUrlExt(url: string): MediaKind | null {
  const pathname = (() => {
    try {
      return new URL(url, 'http://x').pathname.toLowerCase()
    } catch {
      return url.toLowerCase()
    }
  })()
  if (/\.(png|jpe?g|gif|webp|bmp|svg)$/u.test(pathname)) return 'image'
  if (/\.(mp4|mov|webm|m4v)$/u.test(pathname)) return 'video'
  if (/\.(mp3|wav|ogg|m4a|aac)$/u.test(pathname)) return 'audio'
  return null
}

/**
 * Human-friendly byte size (`'1.2 MB'`). `''` for non-positive inputs so the
 * caller can string-concat without a separator. Single source of truth — do
 * not redeclare in components or wake renderers.
 */
export function humanBytes(n: number | null | undefined): string {
  if (!n || n <= 0) return ''
  if (n < 1024) return `${n} B`
  if (n < 1024 * 1024) return `${(n / 1024).toFixed(1)} KB`
  return `${(n / (1024 * 1024)).toFixed(1)} MB`
}

/**
 * Canonical URL for the raw-bytes endpoint owned by `modules/drive/handlers/files.ts`.
 * Co-located with the route so renaming the route is one grep away.
 */
export function driveFileRawUrl(driveFileId: string): string {
  return `/api/drive/file/${encodeURIComponent(driveFileId)}/raw`
}

/**
 * Best-effort MIME → file extension (no leading dot). Used to repair download
 * filenames for inbound WhatsApp media, which arrives with a wamid-shaped
 * `originalName` and no extension. `null` when the MIME is unrecognized —
 * caller should leave the filename alone in that case.
 */
export function extensionFromMime(mime: string | null | undefined): string | null {
  const m = (mime ?? '').toLowerCase().split(';', 1)[0].trim()
  if (!m) return null
  // Pinned table for the formats `send_file` / WhatsApp Cloud API actually ship.
  // Falling back to mime-db here would balloon the bundle for marginal upside;
  // misses degrade to "no extension appended" which is the pre-fix behaviour.
  const table: Record<string, string> = {
    'image/jpeg': 'jpg',
    'image/jpg': 'jpg',
    'image/png': 'png',
    'image/gif': 'gif',
    'image/webp': 'webp',
    'image/bmp': 'bmp',
    'image/svg+xml': 'svg',
    'video/mp4': 'mp4',
    'video/quicktime': 'mov',
    'video/webm': 'webm',
    'video/3gpp': '3gp',
    'audio/mpeg': 'mp3',
    'audio/mp4': 'm4a',
    'audio/aac': 'aac',
    'audio/ogg': 'ogg',
    'audio/opus': 'opus',
    'audio/amr': 'amr',
    'audio/wav': 'wav',
    'application/pdf': 'pdf',
    'application/msword': 'doc',
    'application/vnd.openxmlformats-officedocument.wordprocessingml.document': 'docx',
    'application/vnd.ms-excel': 'xls',
    'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet': 'xlsx',
    'application/zip': 'zip',
    'text/plain': 'txt',
    'text/markdown': 'md',
    'text/csv': 'csv',
    'application/json': 'json',
  }
  return table[m] ?? null
}
