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
} from '../../../contracts/channels';

// ─── Types ───────────────────────────────────────────────────────────

export interface WhatsAppWebhookPayload {
  object: 'whatsapp_business_account';
  entry: Array<{
    id: string;
    changes: Array<{
      value: {
        messaging_product: 'whatsapp';
        metadata: { display_phone_number: string; phone_number_id: string };
        contacts?: Array<{ profile: { name: string }; wa_id: string }>;
        messages?: WhatsAppInboundMessage[];
        statuses?: WhatsAppInboundStatus[];
      };
      field: 'messages';
    }>;
  }>;
}

export interface WhatsAppInboundMessage {
  from: string;
  id: string;
  timestamp: string;
  type: string;
  text?: { body: string };
  image?: WhatsAppMediaInfo;
  document?: WhatsAppMediaInfo & { filename?: string };
  audio?: WhatsAppMediaInfo;
  video?: WhatsAppMediaInfo;
  sticker?: WhatsAppMediaInfo;
  location?: {
    latitude: number;
    longitude: number;
    name?: string;
    address?: string;
  };
  contacts?: Array<{
    name: { formatted_name: string; first_name?: string; last_name?: string };
    phones?: Array<{ phone: string; type?: string }>;
    emails?: Array<{ email: string; type?: string }>;
  }>;
  reaction?: { message_id: string; emoji: string };
  interactive?: {
    type: 'button_reply' | 'list_reply';
    button_reply?: { id: string; title: string };
    list_reply?: { id: string; title: string; description?: string };
  };
  button?: { text: string; payload: string };
  context?: { id: string; forwarded?: boolean; frequently_forwarded?: boolean };
  errors?: Array<{ code: number; title: string; details?: string }>;
}

export interface WhatsAppMediaInfo {
  id: string;
  mime_type: string;
  caption?: string;
  filename?: string;
}

export interface WhatsAppInboundStatus {
  id: string;
  status:
    | 'sent'
    | 'delivered'
    | 'read'
    | 'failed'
    | 'deleted'
    | 'warning'
    | 'pending';
  timestamp: string;
  recipient_id: string;
  errors?: Array<{
    code: number;
    title: string;
    message?: string;
    error_data?: { details?: string };
  }>;
}

/**
 * Callback to download a media file from Meta CDN.
 * Direct adapters provide this using the WABA access token.
 * Pass `null` from proxy adapters — media IDs are preserved but buffers absent.
 */
export type MediaDownloader = (
  mediaId: string,
  mediaType?: string,
) => Promise<{ data: Buffer; mimeType: string } | null>;

// ─── Internal helpers ────────────────────────────────────────────────

async function parseInboundMessage(
  msg: WhatsAppInboundMessage,
  contactMap: Map<string, string>,
  fromToWaId: Map<string, string>,
  downloadMedia: MediaDownloader | null | undefined,
): Promise<ChannelEvent | null> {
  const resolvedWaId = fromToWaId.get(msg.from) ?? msg.from;
  const base = {
    channel: 'whatsapp',
    from: msg.from,
    profileName:
      contactMap.get(msg.from) || contactMap.get(resolvedWaId) || '',
    messageId: msg.id,
    timestamp: Number.parseInt(msg.timestamp, 10) * 1000,
  };

  const baseMetadata: Record<string, unknown> = { waId: resolvedWaId };
  if (msg.context?.id) {
    baseMetadata.replyToMessageId = msg.context.id;
  }

  switch (msg.type) {
    case 'text': {
      return {
        type: 'message_received',
        ...base,
        content: msg.text?.body ?? '',
        messageType: 'text',
        metadata: { ...baseMetadata },
      } satisfies MessageReceivedEvent;
    }

    case 'image':
    case 'document':
    case 'audio':
    case 'video': {
      const mediaInfo =
        msg[msg.type as 'image' | 'document' | 'audio' | 'video'];
      let media: ChannelMedia[] | undefined;

      if (mediaInfo?.id && downloadMedia) {
        const downloaded = await downloadMedia(mediaInfo.id, msg.type);
        if (downloaded) {
          media = [
            {
              type: msg.type as ChannelMedia['type'],
              data: downloaded.data,
              mimeType: downloaded.mimeType,
              filename: mediaInfo.filename,
            },
          ];
        }
      }

      return {
        type: 'message_received',
        ...base,
        content: mediaInfo?.caption ?? '',
        messageType: msg.type as MessageReceivedEvent['messageType'],
        media,
        metadata: { ...baseMetadata },
      } satisfies MessageReceivedEvent;
    }

    case 'sticker': {
      const stickerInfo = msg.sticker;
      let media: ChannelMedia[] | undefined;

      if (stickerInfo?.id && downloadMedia) {
        const downloaded = await downloadMedia(stickerInfo.id, 'sticker');
        if (downloaded) {
          media = [
            {
              type: 'image',
              data: downloaded.data,
              mimeType: downloaded.mimeType,
            },
          ];
        }
      }

      return {
        type: 'message_received',
        ...base,
        content: '',
        messageType: 'image',
        media,
        metadata: { ...baseMetadata, sticker: true },
      } satisfies MessageReceivedEvent;
    }

    case 'location': {
      const loc = msg.location;
      const parts: string[] = [];
      if (loc?.name) parts.push(loc.name);
      if (loc?.address) parts.push(loc.address);
      if (loc) parts.push(`${loc.latitude}, ${loc.longitude}`);

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
      } satisfies MessageReceivedEvent;
    }

    case 'contacts': {
      const msgContacts = msg.contacts;
      const firstContact = msgContacts?.[0];
      const content = firstContact?.name?.formatted_name ?? '';

      return {
        type: 'message_received',
        ...base,
        content,
        messageType: 'unsupported',
        metadata: {
          ...baseMetadata,
          ...(msgContacts ? { contacts: msgContacts } : {}),
        },
      } satisfies MessageReceivedEvent;
    }

    case 'reaction': {
      if (!msg.reaction) return null;
      return {
        type: 'reaction',
        channel: 'whatsapp',
        from: msg.from,
        messageId: msg.reaction.message_id,
        emoji: msg.reaction.emoji,
        action: msg.reaction.emoji === '' ? 'remove' : 'add',
        timestamp: base.timestamp,
      } satisfies ReactionEvent;
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
        } satisfies MessageReceivedEvent;
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
        } satisfies MessageReceivedEvent;
      }
      return {
        type: 'message_received',
        ...base,
        content: '',
        messageType: 'unsupported',
        metadata: { ...baseMetadata },
      } satisfies MessageReceivedEvent;
    }

    case 'button': {
      return {
        type: 'message_received',
        ...base,
        content: msg.button?.text ?? '',
        messageType: 'button_reply',
        metadata: { ...baseMetadata, buttonPayload: msg.button?.payload },
      } satisfies MessageReceivedEvent;
    }

    case 'errors': {
      return {
        type: 'message_received',
        ...base,
        content: '',
        messageType: 'unsupported',
        metadata: { ...baseMetadata, errors: msg.errors },
      } satisfies MessageReceivedEvent;
    }

    default:
      return {
        type: 'message_received',
        ...base,
        content: '',
        messageType: 'unsupported',
        metadata: { ...baseMetadata },
      } satisfies MessageReceivedEvent;
  }
}

function parseInboundStatus(
  status: WhatsAppInboundStatus,
): StatusUpdateEvent {
  let mappedStatus: StatusUpdateEvent['status'];
  switch (status.status) {
    case 'deleted':
      mappedStatus = 'delivered';
      break;
    case 'warning':
      mappedStatus = 'failed';
      break;
    case 'pending':
      mappedStatus = 'sent';
      break;
    default:
      mappedStatus = status.status;
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
  };
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
  if (payload.object !== 'whatsapp_business_account') return [];
  if (!payload.entry?.length) return [];

  const events: ChannelEvent[] = [];

  for (const entry of payload.entry) {
    for (const change of entry.changes) {
      const value = change.value;
      if (!value.messages?.length) continue;

      // Build contact maps: name lookup (keyed by wa_id) and from→wa_id resolver.
      // In 99% of cases msg.from === wa_id, but they can diverge (e.g. Brazilian 9th digit).
      const contactMap = new Map<string, string>();
      const contacts = value.contacts ?? [];
      for (const c of contacts) {
        contactMap.set(c.wa_id, c.profile.name);
      }
      const fromToWaId = new Map<string, string>();
      for (const c of contacts) {
        fromToWaId.set(c.wa_id, c.wa_id);
      }
      // Also key contactMap by msg.from for profile name lookup when from !== wa_id
      for (const msg of value.messages) {
        const contact =
          contacts.find((c) => c.wa_id === msg.from) ?? contacts[0];
        if (contact && contact.wa_id !== msg.from) {
          contactMap.set(msg.from, contact.profile.name);
          fromToWaId.set(msg.from, contact.wa_id);
        }
      }

      for (const msg of value.messages) {
        const event = await parseInboundMessage(
          msg,
          contactMap,
          fromToWaId,
          downloadMedia,
        );
        if (event) events.push(event);
      }
    }
  }

  return events;
}

/**
 * Parse all WhatsApp status updates from a webhook payload into ChannelEvents.
 */
export function parseWhatsAppStatuses(
  payload: WhatsAppWebhookPayload,
): ChannelEvent[] {
  if (payload.object !== 'whatsapp_business_account') return [];
  if (!payload.entry?.length) return [];

  const events: ChannelEvent[] = [];

  for (const entry of payload.entry) {
    for (const change of entry.changes) {
      const value = change.value;
      if (!value.statuses?.length) continue;
      for (const status of value.statuses) {
        events.push(parseInboundStatus(status));
      }
    }
  }

  return events;
}
