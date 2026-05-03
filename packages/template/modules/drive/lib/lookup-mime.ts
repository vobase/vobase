/**
 * Pure ext→mime lookup table.
 *
 * Used by CLI verbs (`drive upload`) and the extract pipeline to derive a
 * mime type from a filename when the source doesn't supply one (Bun.file().type
 * is unreliable for uncommon extensions).
 *
 * Lower-case keys; callers normalise the extension before lookup.
 */

const MIME_BY_EXT: Readonly<Record<string, string>> = {
  // Text + structured
  txt: 'text/plain',
  md: 'text/markdown',
  markdown: 'text/markdown',
  csv: 'text/csv',
  tsv: 'text/tab-separated-values',
  html: 'text/html',
  htm: 'text/html',
  xml: 'application/xml',
  json: 'application/json',

  // Documents
  pdf: 'application/pdf',
  docx: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
  doc: 'application/msword',
  xlsx: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
  xls: 'application/vnd.ms-excel',
  pptx: 'application/vnd.openxmlformats-officedocument.presentationml.presentation',
  ppt: 'application/vnd.ms-powerpoint',
  odt: 'application/vnd.oasis.opendocument.text',

  // Images
  jpg: 'image/jpeg',
  jpeg: 'image/jpeg',
  png: 'image/png',
  gif: 'image/gif',
  webp: 'image/webp',
  heic: 'image/heic',
  heif: 'image/heif',
  bmp: 'image/bmp',
  svg: 'image/svg+xml',

  // Audio / video (binary-stub fallback)
  mp3: 'audio/mpeg',
  wav: 'audio/wav',
  ogg: 'audio/ogg',
  m4a: 'audio/mp4',
  mp4: 'video/mp4',
  mov: 'video/quicktime',
  webm: 'video/webm',

  // Archives
  zip: 'application/zip',
  tar: 'application/x-tar',
  gz: 'application/gzip',
}

const DEFAULT_MIME = 'application/octet-stream'

/** Look up a mime type by filename or bare extension. Returns the octet-stream fallback when unknown. */
export function lookupMime(nameOrExt: string): string {
  const trimmed = nameOrExt.trim().toLowerCase()
  if (!trimmed) return DEFAULT_MIME
  const dot = trimmed.lastIndexOf('.')
  const ext = dot >= 0 ? trimmed.slice(dot + 1) : trimmed
  return MIME_BY_EXT[ext] ?? DEFAULT_MIME
}

/** Extension table — exported so tests can sanity-check coverage without spying on the lookup. */
export const __MIME_BY_EXT = MIME_BY_EXT
