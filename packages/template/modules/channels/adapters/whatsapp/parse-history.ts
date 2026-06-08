/**
 * Pure transform: a coexistence `history` webhook payload → backfill-ready
 * message descriptors, one `ParsedHistoryChunk` per `history[]` element. No
 * I/O. Pinned to Meta's documented `onboarding-business-app-users` wire shape
 * and designed for later extraction to `@vobase/core`.
 *
 * Direction: a message whose `from` is the business's own number is outbound
 * (business → customer); otherwise inbound (customer → business). Media messages
 * arrive as `type: 'media_placeholder'` with no content; the ≤14-day asset
 * follow-up is a separate webhook handled elsewhere.
 *
 * A `history[]` element carrying `errors` (code 2593109) means the business
 * declined to share — surfaced as `declined: true` with no messages.
 */

const MEDIA_TYPES_WITH_CAPTION = new Set(['image', 'document', 'audio', 'video'])

/**
 * Compare two phone numbers by digits only. Meta's `display_phone_number` (the
 * business number) and a message's `from` can differ in formatting — a leading
 * `+`, spaces, or dashes — and a raw string compare would then flip a message's
 * direction, silently mislabeling a staff message as a customer one (or vice
 * versa). Stripping to digits makes the comparison format-insensitive. An empty
 * or absent number never matches, so the safe default is to treat the message as
 * inbound (customer).
 */
function isSameNumber(a: string | undefined, b: string | undefined): boolean {
  const da = (a ?? '').replace(/\D/g, '')
  const db = (b ?? '').replace(/\D/g, '')
  return da.length > 0 && da === db
}

export interface HistoricalMessage {
  /** The WhatsApp user's phone number (`thread.id`) — the contact key. */
  customerPhone: string
  /** WhatsApp message id — the idempotency key for backfill. */
  wamid: string
  /** Original device timestamp, in epoch milliseconds. */
  timestampMs: number
  direction: 'inbound' | 'outbound'
  messageType: string
  content: string
  /** Historical delivery status (DELIVERED/READ/SENT/PLAYED/PENDING/ERROR). */
  status?: string
  isMediaPlaceholder: boolean
}

export interface ParsedHistoryChunk {
  phase: number
  chunkOrder: number
  progress: number
  businessPhone: string
  phoneNumberId: string
  /** True when the business declined to share history (no messages present). */
  declined: boolean
  messages: HistoricalMessage[]
}

interface RawHistoryMessage {
  from?: string
  id?: string
  timestamp?: string
  type?: string
  text?: { body?: string }
  history_context?: { status?: string }
  [key: string]: unknown
}

interface RawHistoryElement {
  metadata?: { phase?: number; chunk_order?: number; progress?: number }
  threads?: Array<{ id?: string; messages?: RawHistoryMessage[] }>
  errors?: Array<{ code?: number }>
}

interface RawHistoryMediaInfo {
  id?: string
  mime_type?: string
  filename?: string
}
interface RawHistoryMediaMessage {
  id?: string
  type?: string
  [key: string]: unknown
}
interface RawHistoryValue {
  metadata?: { display_phone_number?: string; phone_number_id?: string }
  history?: RawHistoryElement[]
  /** The ≤14-day media-asset follow-up rides `messages[]` under `field:history`. */
  messages?: RawHistoryMediaMessage[]
}

interface RawHistoryPayload {
  object?: string
  entry?: Array<{ changes?: Array<{ field?: string; value?: RawHistoryValue }> }>
}

function extractContent(msg: RawHistoryMessage): string {
  if (msg.type === 'text') return msg.text?.body ?? ''
  if (msg.type && MEDIA_TYPES_WITH_CAPTION.has(msg.type)) {
    const media = msg[msg.type]
    if (media && typeof media === 'object' && 'caption' in media) {
      const caption = (media as { caption?: unknown }).caption
      return typeof caption === 'string' ? caption : ''
    }
  }
  return ''
}

export function parseWhatsAppHistory(payload: unknown): ParsedHistoryChunk[] {
  const root = payload as RawHistoryPayload
  if (root?.object !== 'whatsapp_business_account' || !Array.isArray(root.entry)) return []

  const chunks: ParsedHistoryChunk[] = []
  for (const entry of root.entry) {
    for (const change of entry.changes ?? []) {
      if (change.field !== 'history') continue
      const value = change.value
      if (!value || !Array.isArray(value.history)) continue
      const businessPhone = value.metadata?.display_phone_number ?? ''
      const phoneNumberId = value.metadata?.phone_number_id ?? ''

      for (const element of value.history) {
        const messages: HistoricalMessage[] = []
        for (const thread of element.threads ?? []) {
          const customerPhone = thread.id ?? ''
          for (const msg of thread.messages ?? []) {
            const type = msg.type ?? 'unknown'
            // WhatsApp `errors` entries (e.g. "Message type unknown", code
            // 131051) carry no content — drop them so they never create empty
            // inbox conversations.
            if (type === 'errors') continue
            // The wamid is the idempotency key for backfill and the match key for
            // the media-asset follow-up. A message with no id can't be deduped
            // (so it would duplicate on webhook redelivery) and, stored as an
            // empty-string `channelExternalId`, would collide with every other
            // id-less message under the partial unique index — silently dropping
            // all but the first. Skip it rather than corrupt the import.
            if (!msg.id) continue
            messages.push({
              customerPhone,
              wamid: msg.id,
              timestampMs: Number.parseInt(msg.timestamp ?? '0', 10) * 1000,
              direction: isSameNumber(msg.from, businessPhone) ? 'outbound' : 'inbound',
              messageType: type,
              content: extractContent(msg),
              status: msg.history_context?.status,
              isMediaPlaceholder: type === 'media_placeholder',
            })
          }
        }
        chunks.push({
          phase: element.metadata?.phase ?? 0,
          chunkOrder: element.metadata?.chunk_order ?? 0,
          progress: element.metadata?.progress ?? 0,
          businessPhone,
          phoneNumberId,
          declined: Array.isArray(element.errors) && element.errors.length > 0,
          messages,
        })
      }
    }
  }
  return chunks
}

export interface HistoryMediaAsset {
  /** Same WhatsApp message id as the `media_placeholder` it enriches. */
  wamid: string
  mediaId: string
  mediaType: string
  mimeType: string | null
  filename: string
}

/**
 * Parse the ≤14-day media-asset follow-up — which rides `messages[]` (not
 * `history[]`) under `field:history` — into downloadable media descriptors. The
 * `wamid` matches the placeholder created from the history chunk, so the drain
 * can download + attach the bytes to that message.
 */
export function parseHistoryMediaAssets(payload: unknown): HistoryMediaAsset[] {
  const root = payload as RawHistoryPayload
  if (root?.object !== 'whatsapp_business_account' || !Array.isArray(root.entry)) return []

  const out: HistoryMediaAsset[] = []
  for (const entry of root.entry) {
    for (const change of entry.changes ?? []) {
      if (change.field !== 'history') continue
      for (const msg of change.value?.messages ?? []) {
        const type = msg.type
        if (!type) continue
        const info = msg[type] as RawHistoryMediaInfo | undefined
        if (!info?.id) continue
        out.push({
          wamid: msg.id ?? '',
          mediaId: info.id,
          mediaType: type,
          mimeType: info.mime_type ?? null,
          filename: info.filename ?? `${type}-${info.id}`,
        })
      }
    }
  }
  return out
}
