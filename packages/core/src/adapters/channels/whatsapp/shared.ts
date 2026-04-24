/**
 * Shared WhatsApp webhook parsing utilities.
 * Used by the WhatsApp adapter (createWhatsAppAdapter) in both direct and
 * transport-proxied modes. Extracted so parsing logic doesn't depend on
 * Meta credentials.
 */

import type {
  ChannelEvent,
  ChannelMedia,
  MessageReceivedEvent,
  ReactionEvent,
  StatusUpdateEvent,
} from '../../../contracts/channels'

// ─── Types ───────────────────────────────────────────────────────────

export interface WhatsAppWebhookPayload {
  object: 'whatsapp_business_account'
  entry: Array<{
    id: string
    changes: Array<{
      value: {
        messaging_product: 'whatsapp'
        metadata: { display_phone_number: string; phone_number_id: string }
        contacts?: Array<{ profile: { name: string }; wa_id: string }>
        messages?: WhatsAppInboundMessage[]
        statuses?: WhatsAppInboundStatus[]
      }
      field: 'messages' | 'account_update' | 'message_template_status_update'
    }>
  }>
}

export interface WhatsAppInboundMessage {
  from: string
  id: string
  timestamp: string
  type: string
  text?: { body: string }
  image?: WhatsAppMediaInfo
  document?: WhatsAppMediaInfo & { filename?: string }
  audio?: WhatsAppMediaInfo
  video?: WhatsAppMediaInfo
  sticker?: WhatsAppMediaInfo
  location?: {
    latitude: number
    longitude: number
    name?: string
    address?: string
  }
  contacts?: Array<{
    name: { formatted_name: string; first_name?: string; last_name?: string }
    phones?: Array<{ phone: string; type?: string }>
    emails?: Array<{ email: string; type?: string }>
  }>
  reaction?: { message_id: string; emoji: string }
  interactive?: {
    type: 'button_reply' | 'list_reply'
    button_reply?: { id: string; title: string }
    list_reply?: { id: string; title: string; description?: string }
  }
  button?: { text: string; payload: string }
  context?: { id: string; forwarded?: boolean; frequently_forwarded?: boolean }
  errors?: Array<{ code: number; title: string; details?: string }>
  referral?: {
    source_url: string
    source_type: 'ad' | 'post'
    source_id: string
    headline?: string
    body?: string
    media_type?: string
    media_url?: string
    ctwa_clid?: string
  }
}

export interface WhatsAppMediaInfo {
  id: string
  mime_type: string
  caption?: string
  filename?: string
  /** True for voice notes recorded in-app (audio type only). */
  voice?: boolean
  /** True for animated stickers (sticker type only). */
  animated?: boolean
}

export interface WhatsAppInboundStatus {
  id: string
  status: 'sent' | 'delivered' | 'read' | 'failed' | 'deleted' | 'warning' | 'pending'
  timestamp: string
  recipient_id: string
  errors?: Array<{
    code: number
    title: string
    message?: string
    error_data?: { details?: string }
  }>
}

/**
 * Callback to download a media file from Meta CDN.
 * Direct adapters provide this using the WABA access token.
 * Pass `null` from proxy adapters — media IDs are preserved but buffers absent.
 */
export type MediaDownloader = (
  mediaId: string,
  mediaType?: string,
) => Promise<{ data: Buffer; mimeType: string } | null>

// ─── Phone normalization ─────────────────────────────────────────────

/**
 * Normalise a Brazilian WhatsApp phone number to its canonical 13-digit form.
 *
 * WhatsApp Brazil numbers may arrive as either:
 *   - 12-digit `55XXYYYYYYYY`  (no 9th digit after area code) — legacy landline-style
 *   - 13-digit `55XX9YYYYYYYY` (canonical mobile form)
 *
 * The 13-digit form is the UNIQUE constraint key in the contacts table, so both
 * forms must resolve to the same string.
 *
 * Non-Brazil numbers (don't start with `55` + 2-digit area + 8-digit local)
 * are returned unchanged.
 */
export function normalizeBrazilPhone(phone: string): string {
  // Already canonical: 55 + 2-digit area + 9 + 8-digit subscriber = 13 digits
  if (/^55\d{2}9\d{8}$/.test(phone)) {
    return phone
  }
  // Legacy form: 55 + 2-digit area + 8-digit subscriber = 12 digits — insert 9
  const m = phone.match(/^55(\d{2})(\d{8})$/)
  if (m) {
    return `55${m[1]}9${m[2]}`
  }
  return phone
}

/**
 * Normalise any WhatsApp phone number.
 * Currently applies Brazil-specific normalisation; other countries pass through.
 */
export function normalizeWhatsAppPhone(phone: string): string {
  return normalizeBrazilPhone(phone)
}

// ─── Status ordering ─────────────────────────────────────────────────

/**
 * Numeric rank for each WhatsApp delivery status.
 * Higher rank = further along the delivery pipeline.
 * `failed` is rank 0 — it is always accepted regardless of order (see shouldUpdateStatus).
 */
export const WA_STATUS_ORDER: Record<string, number> = {
  sent: 1,
  delivered: 2,
  read: 3,
  failed: 0,
}

/**
 * Decide whether an incoming status update should overwrite the current one.
 *
 * Rules:
 * 1. `failed` is always accepted (terminal error, must record it).
 * 2. Recovery from `failed` is always accepted (status resolved).
 * 3. Otherwise, only accept if the incoming rank is strictly higher than current.
 */
export function shouldUpdateStatus(current: string | null, incoming: string): boolean {
  if (incoming === 'failed') return true
  if (current === 'failed') return true
  const incomingRank = WA_STATUS_ORDER[incoming] ?? -1
  const currentRank = current != null ? (WA_STATUS_ORDER[current] ?? -1) : -1
  return incomingRank > currentRank
}

// ─── Internal helpers ────────────────────────────────────────────────

async function parseInboundMessage(
  msg: WhatsAppInboundMessage,
  contactMap: Map<string, string>,
  fromToWaId: Map<string, string>,
  downloadMedia: MediaDownloader | null | undefined,
): Promise<ChannelEvent | null> {
  const normalizedFrom = normalizeWhatsAppPhone(msg.from)
  const resolvedWaId = normalizeWhatsAppPhone(fromToWaId.get(normalizedFrom) ?? normalizedFrom)
  const base = {
    channel: 'whatsapp',
    from: normalizedFrom,
    profileName: contactMap.get(normalizedFrom) || contactMap.get(resolvedWaId) || '',
    messageId: msg.id,
    timestamp: Number.parseInt(msg.timestamp, 10) * 1000,
  }

  const baseMetadata: Record<string, unknown> = { waId: resolvedWaId }
  if (msg.context?.id) {
    baseMetadata.replyToMessageId = msg.context.id
  }
  if (msg.referral) {
    baseMetadata.referral = msg.referral
  }

  switch (msg.type) {
    case 'text': {
      return {
        type: 'message_received',
        ...base,
        content: msg.text?.body ?? '',
        messageType: 'text',
        metadata: { ...baseMetadata },
      } satisfies MessageReceivedEvent
    }

    case 'image':
    case 'document':
    case 'audio':
    case 'video': {
      const mediaInfo = msg[msg.type as 'image' | 'document' | 'audio' | 'video']
      let media: ChannelMedia[] | undefined

      if (mediaInfo?.id && downloadMedia) {
        const downloaded = await downloadMedia(mediaInfo.id, msg.type)
        if (downloaded) {
          media = [
            {
              type: msg.type as ChannelMedia['type'],
              data: downloaded.data,
              mimeType: downloaded.mimeType,
              filename: mediaInfo.filename,
            },
          ]
        }
      }

      const mediaMetadata: Record<string, unknown> = { ...baseMetadata }
      if (msg.type === 'audio' && msg.audio?.voice) {
        mediaMetadata.voice = true
      }

      return {
        type: 'message_received',
        ...base,
        content: mediaInfo?.caption ?? '',
        messageType: msg.type as MessageReceivedEvent['messageType'],
        media,
        metadata: mediaMetadata,
      } satisfies MessageReceivedEvent
    }

    case 'sticker': {
      const stickerInfo = msg.sticker
      let media: ChannelMedia[] | undefined

      if (stickerInfo?.id && downloadMedia) {
        const downloaded = await downloadMedia(stickerInfo.id, 'sticker')
        if (downloaded) {
          media = [
            {
              type: 'image',
              data: downloaded.data,
              mimeType: downloaded.mimeType,
            },
          ]
        }
      }

      return {
        type: 'message_received',
        ...base,
        content: '',
        messageType: 'image',
        media,
        metadata: {
          ...baseMetadata,
          sticker: true,
          ...(stickerInfo?.animated ? { animated: true } : {}),
        },
      } satisfies MessageReceivedEvent
    }

    case 'location': {
      const loc = msg.location
      const parts: string[] = []
      if (loc?.name) parts.push(loc.name)
      if (loc?.address) parts.push(loc.address)
      if (loc) parts.push(`${loc.latitude}, ${loc.longitude}`)

      return {
        type: 'message_received',
        ...base,
        content: parts.join(' — ') || '',
        messageType: 'unsupported',
        metadata: {
          ...baseMetadata,
          ...(loc
            ? {
                location: {
                  latitude: loc.latitude,
                  longitude: loc.longitude,
                  name: loc.name,
                  address: loc.address,
                },
              }
            : {}),
        },
      } satisfies MessageReceivedEvent
    }

    case 'contacts': {
      const msgContacts = msg.contacts
      const firstContact = msgContacts?.[0]
      const content = firstContact?.name?.formatted_name ?? ''

      return {
        type: 'message_received',
        ...base,
        content,
        messageType: 'unsupported',
        metadata: {
          ...baseMetadata,
          ...(msgContacts ? { contacts: msgContacts } : {}),
        },
      } satisfies MessageReceivedEvent
    }

    case 'reaction': {
      if (!msg.reaction) return null
      return {
        type: 'reaction',
        channel: 'whatsapp',
        from: msg.from,
        messageId: msg.reaction.message_id,
        emoji: msg.reaction.emoji,
        action: msg.reaction.emoji === '' ? 'remove' : 'add',
        timestamp: base.timestamp,
      } satisfies ReactionEvent
    }

    case 'interactive': {
      if (msg.interactive?.button_reply) {
        return {
          type: 'message_received',
          ...base,
          content: msg.interactive.button_reply.title,
          messageType: 'button_reply',
          metadata: {
            ...baseMetadata,
            buttonId: msg.interactive.button_reply.id,
          },
        } satisfies MessageReceivedEvent
      }
      if (msg.interactive?.list_reply) {
        return {
          type: 'message_received',
          ...base,
          content: msg.interactive.list_reply.title,
          messageType: 'list_reply',
          metadata: {
            ...baseMetadata,
            listId: msg.interactive.list_reply.id,
            description: msg.interactive.list_reply.description,
          },
        } satisfies MessageReceivedEvent
      }
      return {
        type: 'message_received',
        ...base,
        content: '',
        messageType: 'unsupported',
        metadata: { ...baseMetadata },
      } satisfies MessageReceivedEvent
    }

    case 'button': {
      return {
        type: 'message_received',
        ...base,
        content: msg.button?.text ?? '',
        messageType: 'button_reply',
        metadata: { ...baseMetadata, buttonPayload: msg.button?.payload },
      } satisfies MessageReceivedEvent
    }

    case 'errors': {
      return {
        type: 'message_received',
        ...base,
        content: '',
        messageType: 'unsupported',
        metadata: { ...baseMetadata, errors: msg.errors },
      } satisfies MessageReceivedEvent
    }

    default:
      return {
        type: 'message_received',
        ...base,
        content: '',
        messageType: 'unsupported',
        metadata: { ...baseMetadata },
      } satisfies MessageReceivedEvent
  }
}

function parseInboundStatus(status: WhatsAppInboundStatus): StatusUpdateEvent {
  let mappedStatus: StatusUpdateEvent['status']
  switch (status.status) {
    case 'deleted':
      mappedStatus = 'delivered'
      break
    case 'warning':
      mappedStatus = 'failed'
      break
    case 'pending':
      mappedStatus = 'sent'
      break
    default:
      mappedStatus = status.status
  }

  return {
    type: 'status_update',
    channel: 'whatsapp',
    messageId: status.id,
    status: mappedStatus,
    timestamp: Number.parseInt(status.timestamp, 10) * 1000,
    metadata: {
      ...(status.errors?.length ? { errors: status.errors } : {}),
      ...(status.status === 'deleted' ? { deleted: true } : {}),
      ...(status.status === 'warning' ? { warning: true } : {}),
      ...(status.status === 'pending' ? { pending: true } : {}),
    },
  }
}

// ─── Public API ──────────────────────────────────────────────────────

/**
 * Parse all inbound WhatsApp messages from a webhook payload into ChannelEvents.
 *
 * @param payload  - The WhatsApp webhook payload (must have object='whatsapp_business_account').
 * @param downloadMedia - Callback to download media files. Pass the adapter's media downloader
 *   for direct channels (eagerly downloads buffers), or `null` for proxy/shared channels
 *   (media IDs are preserved in metadata but buffers are absent — text messages only in V1).
 */
export async function parseWhatsAppMessages(
  payload: WhatsAppWebhookPayload,
  downloadMedia?: MediaDownloader | null,
): Promise<ChannelEvent[]> {
  if (payload.object !== 'whatsapp_business_account') return []
  if (!payload.entry?.length) return []

  const events: ChannelEvent[] = []

  for (const entry of payload.entry) {
    for (const change of entry.changes) {
      const value = change.value
      if (!value.messages?.length) continue

      // Build contact maps: name lookup (keyed by wa_id) and from→wa_id resolver.
      // In 99% of cases msg.from === wa_id, but they can diverge (e.g. Brazilian 9th digit).
      const contactMap = new Map<string, string>()
      const contacts = value.contacts ?? []
      for (const c of contacts) {
        contactMap.set(c.wa_id, c.profile.name)
      }
      const fromToWaId = new Map<string, string>()
      for (const c of contacts) {
        fromToWaId.set(c.wa_id, c.wa_id)
      }
      // Also key contactMap by msg.from for profile name lookup when from !== wa_id
      for (const msg of value.messages) {
        const contact = contacts.find((c) => c.wa_id === msg.from) ?? contacts[0]
        if (contact && contact.wa_id !== msg.from) {
          contactMap.set(msg.from, contact.profile.name)
          fromToWaId.set(msg.from, contact.wa_id)
        }
      }

      for (const msg of value.messages) {
        const event = await parseInboundMessage(msg, contactMap, fromToWaId, downloadMedia)
        if (event) events.push(event)
      }
    }
  }

  return events
}

/**
 * Parse all WhatsApp status updates from a webhook payload into ChannelEvents.
 */
export function parseWhatsAppStatuses(payload: WhatsAppWebhookPayload): ChannelEvent[] {
  if (payload.object !== 'whatsapp_business_account') return []
  if (!payload.entry?.length) return []

  const events: ChannelEvent[] = []

  for (const entry of payload.entry) {
    for (const change of entry.changes) {
      const value = change.value
      if (!value.statuses?.length) continue
      for (const status of value.statuses) {
        events.push(parseInboundStatus(status))
      }
    }
  }

  return events
}

/**
 * Parse echo messages (outbound messages sent via the WhatsApp Business App)
 * from a webhook payload.
 *
 * Echoes appear as inbound messages where `msg.from` matches the business's
 * own `phone_number_id` (i.e. the message was sent by staff, not received from
 * a contact). Each echo is returned as a `MessageReceivedEvent` with:
 *   - `metadata.echo: true`
 *   - `metadata.echoSource: 'business_app'`
 *   - `metadata.direction: 'outbound'`
 */
export async function parseWhatsAppEchoes(
  payload: WhatsAppWebhookPayload,
  downloadMedia?: MediaDownloader | null,
): Promise<ChannelEvent[]> {
  if (payload.object !== 'whatsapp_business_account') return []
  if (!payload.entry?.length) return []

  const events: ChannelEvent[] = []

  for (const entry of payload.entry) {
    for (const change of entry.changes) {
      const value = change.value
      if (!value.messages?.length) continue

      const phoneNumberId = value.metadata.phone_number_id

      for (const msg of value.messages) {
        // Echo: the message was sent by the business itself
        if (msg.from !== phoneNumberId) continue

        const parsed = await parseInboundMessage(msg, new Map(), new Map(), downloadMedia)
        if (!parsed) continue

        if (parsed.type === 'message_received') {
          events.push({
            ...parsed,
            metadata: {
              ...parsed.metadata,
              echo: true,
              echoSource: 'business_app',
              direction: 'outbound',
            },
          })
        } else {
          events.push(parsed)
        }
      }
    }
  }

  return events
}

/**
 * Parse WhatsApp contact-change events (SMB app state sync).
 *
 * WhatsApp Business App sends `field: 'account_update'` changes when contacts
 * are added, edited, or removed. Each contact change is emitted as a
 * `MessageReceivedEvent` with `metadata.contactUpdate` so it flows through the
 * existing event pipeline without adding a new union member.
 */
export function parseWhatsAppContactUpdates(payload: WhatsAppWebhookPayload): ChannelEvent[] {
  if (payload.object !== 'whatsapp_business_account') return []
  if (!payload.entry?.length) return []

  const events: ChannelEvent[] = []

  for (const entry of payload.entry) {
    for (const change of entry.changes) {
      if (change.field !== 'account_update') continue

      const value = change.value as unknown as {
        phone_number?: string
        event?: string
        contacts?: Array<{
          action?: string
          wa_id?: string
          profile?: { name?: string }
        }>
      }

      const rawContacts = value.contacts ?? []
      for (const contact of rawContacts) {
        if (!contact.wa_id) continue // skip contacts without a WhatsApp ID
        const action = (contact.action as 'add' | 'remove' | 'edit') ?? 'edit'
        events.push({
          type: 'message_received',
          channel: 'whatsapp',
          from: contact.wa_id,
          profileName: contact.profile?.name ?? '',
          messageId: `contact-update-${contact.wa_id ?? ''}-${Date.now()}`,
          timestamp: Date.now(),
          content: '',
          messageType: 'unsupported',
          metadata: {
            contactUpdate: {
              action,
              contact,
            },
          },
        } satisfies MessageReceivedEvent)
      }
    }
  }

  return events
}
