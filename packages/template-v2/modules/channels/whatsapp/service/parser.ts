/**
 * Meta WhatsApp Cloud API webhook → canonical ChannelInboundEvent.
 *
 * R1 discipline (A6): imports ChannelInboundEvent from @server/contracts/channel-event,
 * NEVER from Drizzle inference (zero InferSelectModel hits in this file).
 *
 * 100% fixture-tested — all branches covered in tests/parser.test.ts.
 */
import type { ChannelInboundEvent } from '@server/contracts/channel-event'
import { z } from 'zod'

// ─── Meta webhook payload schemas ──────────────────────────────────────────

const MetaTextSchema = z.object({ body: z.string() })
const MetaImageSchema = z.object({ id: z.string(), caption: z.string().optional(), mime_type: z.string().optional() })
const MetaAudioSchema = z.object({ id: z.string(), mime_type: z.string().optional() })
const MetaDocumentSchema = z.object({ id: z.string(), filename: z.string().optional(), caption: z.string().optional() })
const MetaVideoSchema = z.object({ id: z.string(), caption: z.string().optional() })
const MetaButtonReplySchema = z.object({ id: z.string(), title: z.string() })
const MetaListReplySchema = z.object({ id: z.string(), title: z.string(), description: z.string().optional() })
const MetaInteractiveSchema = z.object({
  type: z.enum(['button_reply', 'list_reply']),
  button_reply: MetaButtonReplySchema.optional(),
  list_reply: MetaListReplySchema.optional(),
})

const MetaMessageSchema = z.object({
  from: z.string(),
  id: z.string(),
  timestamp: z.string(),
  type: z.string(),
  text: MetaTextSchema.optional(),
  image: MetaImageSchema.optional(),
  audio: MetaAudioSchema.optional(),
  document: MetaDocumentSchema.optional(),
  video: MetaVideoSchema.optional(),
  interactive: MetaInteractiveSchema.optional(),
})

const MetaStatusSchema = z.object({
  id: z.string(),
  status: z.string(),
  timestamp: z.string(),
  recipient_id: z.string(),
})

const MetaContactSchema = z.object({
  profile: z.object({ name: z.string() }).optional(),
  wa_id: z.string(),
})

const MetaValueSchema = z.object({
  messaging_product: z.string().optional(),
  metadata: z
    .object({
      phone_number_id: z.string(),
      display_phone_number: z.string().optional(),
    })
    .optional(),
  contacts: z.array(MetaContactSchema).optional(),
  messages: z.array(MetaMessageSchema).optional(),
  statuses: z.array(MetaStatusSchema).optional(),
})

const MetaChangeSchema = z.object({ value: MetaValueSchema, field: z.string().optional() })
const MetaEntrySchema = z.object({ id: z.string(), changes: z.array(MetaChangeSchema) })

export const MetaWebhookPayloadSchema = z.object({
  object: z.string(),
  entry: z.array(MetaEntrySchema),
})

export type MetaWebhookPayload = z.infer<typeof MetaWebhookPayloadSchema>

// ─── Parser ─────────────────────────────────────────────────────────────────

function contentTypeFor(type: string): ChannelInboundEvent['contentType'] {
  switch (type) {
    case 'text':
      return 'text'
    case 'image':
      return 'image'
    case 'audio':
      return 'audio'
    case 'document':
      return 'document'
    case 'video':
      return 'video'
    case 'interactive':
      return 'button_reply'
    default:
      return 'unsupported'
  }
}

function extractContent(msg: z.infer<typeof MetaMessageSchema>): string {
  switch (msg.type) {
    case 'text':
      return msg.text?.body ?? ''
    case 'image':
      return msg.image?.caption ?? `[image:${msg.image?.id ?? ''}]`
    case 'audio':
      return `[audio:${msg.audio?.id ?? ''}]`
    case 'document':
      return msg.document?.caption ?? msg.document?.filename ?? `[document:${msg.document?.id ?? ''}]`
    case 'video':
      return msg.video?.caption ?? `[video:${msg.video?.id ?? ''}]`
    case 'interactive': {
      const ia = msg.interactive
      if (ia?.type === 'button_reply') return ia.button_reply?.title ?? ia.button_reply?.id ?? ''
      if (ia?.type === 'list_reply') return ia.list_reply?.title ?? ia.list_reply?.id ?? ''
      return '[interactive]'
    }
    default:
      return `[${msg.type}]`
  }
}

function extractContentType(msg: z.infer<typeof MetaMessageSchema>): ChannelInboundEvent['contentType'] {
  if (msg.type === 'interactive') {
    return msg.interactive?.type === 'list_reply' ? 'list_reply' : 'button_reply'
  }
  return contentTypeFor(msg.type)
}

/**
 * Parse a validated Meta webhook payload into canonical ChannelInboundEvents.
 *
 * @param payload - validated MetaWebhookPayload
 * @param tenantId - resolved from webhook signature / channel instance
 * @returns array of ChannelInboundEvents (may be empty for ignored event types)
 */
export function parseWebhookPayload(payload: MetaWebhookPayload, tenantId: string): ChannelInboundEvent[] {
  const events: ChannelInboundEvent[] = []

  for (const entry of payload.entry) {
    for (const change of entry.changes) {
      const value = change.value

      // Contact display name lookup keyed by wa_id
      const contactNames = new Map<string, string>()
      for (const c of value.contacts ?? []) {
        contactNames.set(c.wa_id, c.profile?.name ?? '')
      }

      const displayPhone = value.metadata?.display_phone_number

      // Inbound messages — skip echoes (sent from WhatsApp Business app)
      for (const msg of value.messages ?? []) {
        if (displayPhone && msg.from === displayPhone) continue
        events.push({
          tenantId,
          channelType: 'whatsapp',
          externalMessageId: msg.id,
          from: msg.from,
          profileName: contactNames.get(msg.from) ?? '',
          content: extractContent(msg),
          contentType: extractContentType(msg),
          timestamp: Number(msg.timestamp) * 1000,
          metadata: {
            waType: msg.type,
            phoneNumberId: value.metadata?.phone_number_id ?? '',
          },
        })
      }

      // Status updates — modelled as unsupported inbound events so the wake
      // scheduler can optionally act on delivery receipts.
      for (const status of value.statuses ?? []) {
        events.push({
          tenantId,
          channelType: 'whatsapp',
          externalMessageId: status.id,
          from: status.recipient_id,
          profileName: '',
          content: status.status,
          contentType: 'unsupported',
          timestamp: Number(status.timestamp) * 1000,
          metadata: { waStatusUpdate: status.status },
        })
      }
    }
  }

  return events
}
