/**
 * Stub markdown renderer for binary files.
 *
 * Generates the body of `<stem>.<ext>` rows whose mime type isn't extractable
 * (mp4, zip, exotic binaries, oversized PDFs). The agent reads the stub via
 * `cat /contacts/<id>/.../intro.mp4` and acts on the affordances:
 *
 *   - `send_file <id>` → forward bytes to the customer.
 *   - `request_caption <path>` → ask the harness to OCR/caption (~30s).
 *
 * Frontmatter mirrors the row state so re-extraction can detect drift.
 */

const KB = 1024
const MB = 1024 * 1024
const GB = 1024 * 1024 * 1024

/** Format a byte count as a human-readable string (bytes / KB / MB / GB, one decimal). */
export function humanBytes(n: number): string {
  if (n < KB) return `${n} B`
  if (n < MB) return `${(n / KB).toFixed(1)} KB`
  if (n < GB) return `${(n / MB).toFixed(1)} MB`
  return `${(n / GB).toFixed(1)} GB`
}

/** Format a mime type as a friendly label (`application/pdf` → `PDF document`). */
export function humanMime(mime: string): string {
  if (mime === 'application/pdf') return 'PDF document'
  if (mime.startsWith('image/')) return `${mime.slice('image/'.length).toUpperCase()} image`
  if (mime.startsWith('video/')) return `${mime.slice('video/'.length).toUpperCase()} video`
  if (mime.startsWith('audio/')) return `${mime.slice('audio/'.length).toUpperCase()} audio`
  if (mime === 'application/zip') return 'ZIP archive'
  if (mime === 'application/octet-stream') return 'Binary file'
  return mime
}

export interface RenderStubInput {
  mimeType: string
  sizeBytes: number
  /** The bytes-as-uploaded filename (`quote.pdf`). */
  name: string
  /** Display path inside the drive (`/contacts/abc/wa-1/attachments/intro.mp4`). */
  path: string
  /** Storage object key — the durable handle for `send_file`. */
  storageKey: string
}

/**
 * Render the markdown body for a binary-stub row. The generated body is what
 * `messages.md` materializer surfaces to the agent — keep it short, action-
 * oriented, and side-effect-free (no LLM calls).
 */
export function renderStub(input: RenderStubInput): string {
  const human = humanMime(input.mimeType)
  const size = humanBytes(input.sizeBytes)
  const lines: string[] = [
    '---',
    'type: binary-file',
    `mime: ${input.mimeType}`,
    `name: ${input.name}`,
    `size: ${size}`,
    `storage_key: ${input.storageKey}`,
    '---',
    '',
    `# ${human} — ${size}`,
    '',
    `Original file: \`${input.name}\``,
    `Drive path: \`${input.path}\``,
    '',
    '## What you can do with this file',
    '',
    `- \`send_file ${input.path}\` — forward the original bytes to the customer.`,
    `- \`request_caption ${input.path}\` — ask the agent runtime to caption / OCR this asset (~30s; result surfaces on the next wake).`,
    '',
    'There is no extracted text in the workspace because this mime type is not text-extractable. Do NOT `cat` again hoping for content — call one of the actions above instead.',
    '',
  ]
  return lines.join('\n')
}
