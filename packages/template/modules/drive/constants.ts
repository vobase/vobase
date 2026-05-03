/**
 * Drive module constants — bucket name, embedding model, job name, size caps,
 * per-org daily budget caps, and the extractable-mime allow list.
 *
 * Kept in a leaf file (no other module imports) so test fixtures can poke
 * sentinel values without dragging in the schema, service, or job module.
 */

export const DRIVE_STORAGE_BUCKET = 'drive'

export const EMBEDDING_DIM = 1536
export const EMBEDDING_MODEL = 'text-embedding-3-small'

export const DRIVE_PROCESS_FILE_JOB = 'drive:process-file'

/** A pending row older than this is presumed crashed; the reaper re-enqueues. */
export const DRIVE_REAPER_STALE_MS = 5 * 60_000

/** Inbound channel attachments above this are dropped at the WA adapter layer. */
export const INBOUND_ATTACHMENT_MAX_BYTES = 25 * 1024 * 1024

/** Files above this route to binary-stub regardless of mime — extraction is not attempted. */
export const EXTRACTABLE_MAX_BYTES = 10 * 1024 * 1024

/** Hard cap on chunks per file — past this we truncate + log `processingError`. */
export const MAX_CHUNKS_PER_FILE = 5_000

/** `request_caption` rejects files above this size — caller must `send_file` instead. */
export const REQUEST_CAPTION_MAX_BYTES = 10 * 1024 * 1024

/** Per-org daily OCR page cap. The job rejects work past this with `org_daily_budget_exceeded`. */
export const OCR_PAGE_CAP_PER_DAY_PER_ORG = 200

/** Per-org daily embedding token cap. */
export const EMBED_TOKEN_CAP_PER_DAY_PER_ORG = 5_000_000

/**
 * PDF per-page readability gate. A page whose pdfium-extracted text falls
 * below either threshold is considered "image-only or watermark-only" and
 * routed to OCR instead of being trusted as-is. Ports v1's `isReadableText`
 * (printable-char ratio + min-length) — v2 used to gate purely on
 * `length === 0`, which silently shipped image PDFs that happened to carry
 * a stray watermark glyph.
 */
export const MIN_READABLE_CHARS_PER_PAGE = 40
export const MIN_PRINTABLE_RATIO = 0.6

/**
 * Mime types we attempt extraction for. Anything not in this set routes to
 * binary-stub. Magic-byte sniff in `lib/extract.ts` runs first; the extension
 * is only consulted to disambiguate zip-family containers (docx/xlsx/pptx).
 */
export const EXTRACTABLE_MIMES: ReadonlySet<string> = new Set([
  'text/plain',
  'text/markdown',
  'text/csv',
  'text/html',
  'application/pdf',
  'application/json',
  'application/xml',
  'application/vnd.openxmlformats-officedocument.wordprocessingml.document', // .docx
  'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet', // .xlsx
  'application/vnd.openxmlformats-officedocument.presentationml.presentation', // .pptx
  'application/vnd.oasis.opendocument.text', // .odt
  'application/msword', // .doc (officeparser)
  'application/vnd.ms-excel', // .xls (officeparser)
  'application/vnd.ms-powerpoint', // .ppt (officeparser)
  'image/jpeg',
  'image/png',
  'image/gif',
  'image/webp',
])
