import crypto from 'node:crypto';

import type {
  ChannelAdapter,
  ChannelCapabilities,
  ChannelEvent,
  ChannelMedia,
  MessageReceivedEvent,
  OutboundMessage,
  ReactionEvent,
  SendResult,
  StatusUpdateEvent,
} from '../../../contracts/channels';
import type { HttpClient } from '../../../infra/http-client';
import type { WhatsAppChannelConfig } from '../index';

// ─── Types ───────────────────────────────────────────────────────────

export interface WhatsAppTemplate {
  id: string;
  name: string;
  language: string;
  category: string;
  status: string;
  components: unknown[];
}

interface WebhookPayload {
  object: 'whatsapp_business_account';
  entry: Array<{
    id: string;
    changes: Array<{
      value: {
        messaging_product: 'whatsapp';
        metadata: { display_phone_number: string; phone_number_id: string };
        contacts?: Array<{ profile: { name: string }; wa_id: string }>;
        messages?: InboundMessage[];
        statuses?: InboundStatus[];
      };
      field: 'messages';
    }>;
  }>;
}

interface InboundMessage {
  from: string;
  id: string;
  timestamp: string;
  type: string;
  text?: { body: string };
  image?: MediaInfo;
  document?: MediaInfo & { filename?: string };
  audio?: MediaInfo;
  video?: MediaInfo;
  sticker?: MediaInfo;
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
}

interface MediaInfo {
  id: string;
  mime_type: string;
  caption?: string;
  filename?: string;
}

interface InboundStatus {
  id: string;
  status: 'sent' | 'delivered' | 'read' | 'failed' | 'deleted' | 'warning';
  timestamp: string;
  recipient_id: string;
  errors?: Array<{
    code: number;
    title: string;
    message?: string;
    error_data?: { details?: string };
  }>;
}

// ─── Error Class ─────────────────────────────────────────────────────

export class WhatsAppApiError extends Error {
  readonly code: number;
  readonly errorSubcode?: number;
  readonly fbtraceId?: string;
  readonly httpStatus: number;

  constructor(
    message: string,
    httpStatus: number,
    code: number,
    errorSubcode?: number,
    fbtraceId?: string,
  ) {
    super(message);
    this.name = 'WhatsAppApiError';
    this.httpStatus = httpStatus;
    this.code = code;
    this.errorSubcode = errorSubcode;
    this.fbtraceId = fbtraceId;
  }
}

// ─── Constants ───────────────────────────────────────────────────────

const MAX_TEXT_LENGTH = 4096;
const EVICTION_TTL_MS = 60_000;
const MAX_MEDIA_SIZE = 25 * 1024 * 1024; // 25MB

// ─── Error Code Map ──────────────────────────────────────────────────

const ERROR_CODE_MAP: Record<number, { code: string; retryable: boolean }> = {
  130429: { code: 'rate_limited', retryable: true },
  131056: { code: 'pair_rate_limited', retryable: true },
  131030: { code: 'invalid_recipient', retryable: false },
  131047: { code: 'window_expired', retryable: false },
  131050: { code: 'opted_out', retryable: false },
  131051: { code: 'unsupported_type', retryable: false },
  132000: { code: 'template_param_mismatch', retryable: false },
  132012: { code: 'template_not_found', retryable: false },
  132015: { code: 'template_paused', retryable: false },
  190: { code: 'invalid_token', retryable: false },
  133010: { code: 'not_registered', retryable: false },
};

// ─── Helpers ─────────────────────────────────────────────────────────

function graphUrl(apiVersion: string, path: string): string {
  return `https://graph.facebook.com/${apiVersion}${path}`;
}

async function parseGraphError(res: Response): Promise<never> {
  let body: string | undefined;
  try {
    body = await res.text();
  } catch {
    // ignore read errors
  }

  if (body) {
    try {
      const parsed = JSON.parse(body);
      if (parsed.error) {
        const e = parsed.error;
        throw new WhatsAppApiError(
          e.message ?? `WhatsApp API error ${e.code}`,
          res.status,
          e.code ?? 0,
          e.error_subcode,
          e.fbtrace_id,
        );
      }
    } catch (err) {
      if (err instanceof WhatsAppApiError) throw err;
      // Not valid JSON or no error field — fall through
    }
  }

  throw new WhatsAppApiError(
    `WhatsApp API ${res.status}: ${body ?? 'unknown error'}`,
    res.status,
    0,
  );
}

/**
 * Split text into chunks of at most `maxLen` characters.
 * Tries paragraph breaks first, then line breaks, then hard cut.
 */
function chunkText(text: string, maxLen = MAX_TEXT_LENGTH): string[] {
  if (text.length === 0) return [text];
  if (text.length <= maxLen) return [text];

  const chunks: string[] = [];
  let remaining = text;

  while (remaining.length > 0) {
    if (remaining.length <= maxLen) {
      chunks.push(remaining);
      break;
    }

    let splitAt = -1;

    // Try paragraph break
    const paraIdx = remaining.lastIndexOf('\n\n', maxLen);
    if (paraIdx > 0) {
      splitAt = paraIdx;
    }

    // Try line break
    if (splitAt === -1) {
      const lineIdx = remaining.lastIndexOf('\n', maxLen);
      if (lineIdx > 0) {
        splitAt = lineIdx;
      }
    }

    // Hard cut
    if (splitAt === -1) {
      splitAt = maxLen;
    }

    chunks.push(remaining.slice(0, splitAt));
    remaining = remaining.slice(splitAt).replace(/^\n+/, '');
  }

  return chunks;
}

// ─── Factory ─────────────────────────────────────────────────────────

export function createWhatsAppAdapter(
  config: WhatsAppChannelConfig,
  httpClient?: HttpClient,
): ChannelAdapter & {
  markAsRead(messageId: string): Promise<void>;
  syncTemplates(): Promise<WhatsAppTemplate[]>;
} {
  const { phoneNumberId, accessToken, appSecret } = config;
  const apiVersion = config.apiVersion ?? 'v22.0';

  // ─── graphFetch closure ───────────────────────────────────────

  type GraphApiResponse = {
    messages?: Array<{ id: string }>;
    url?: string;
    mime_type?: string;
    wabaId?: string;
    data?: unknown[];
    [key: string]: unknown;
  };

  async function graphFetch(
    path: string,
    options: RequestInit = {},
  ): Promise<GraphApiResponse> {
    const url = graphUrl(apiVersion, path);
    const authHeaders = { Authorization: `Bearer ${accessToken}` };

    if (httpClient) {
      const method = (options.method ?? 'GET').toLowerCase();
      const headers = {
        ...authHeaders,
        ...(options.headers as Record<string, string> | undefined),
      };

      if (method === 'post' || method === 'put') {
        const body =
          typeof options.body === 'string'
            ? JSON.parse(options.body)
            : options.body;
        const res = await httpClient[method](url, body, { headers });
        if (!res.ok) {
          // Reconstruct a Response-like object to reuse parseGraphError
          const synthetic = new Response(JSON.stringify(res.data), {
            status: res.status,
          });
          await parseGraphError(synthetic);
        }
        return res.data as GraphApiResponse;
      } else {
        const res = await httpClient.get(url, { headers });
        if (!res.ok) {
          const synthetic = new Response(JSON.stringify(res.data), {
            status: res.status,
          });
          await parseGraphError(synthetic);
        }
        return res.data as GraphApiResponse;
      }
    }

    // Fallback to raw fetch (backward compat / tests)
    const res = await fetch(url, {
      ...options,
      headers: {
        ...authHeaders,
        'Content-Type': 'application/json',
        ...options.headers,
      },
    });
    if (!res.ok) {
      await parseGraphError(res);
    }
    return res.json() as Promise<GraphApiResponse>;
  }

  // ─── downloadMedia closure ────────────────────────────────────

  async function downloadMedia(
    mediaId: string,
  ): Promise<{ data: Buffer; mimeType: string } | null> {
    try {
      const meta = await graphFetch(`/${mediaId}`);
      const mediaUrl = meta.url as string;
      if (!mediaUrl) return null;

      // Always use plain fetch for binary media downloads — httpClient parses
      // the response body (JSON/text) which makes it unsuitable for binary data.
      const binRes = await fetch(mediaUrl, {
        headers: { Authorization: `Bearer ${accessToken}` },
      });
      if (!binRes.ok) return null;

      // Check content-length before downloading to enforce size limit
      const contentLength = binRes.headers.get('content-length');
      if (contentLength !== null) {
        const size = Number.parseInt(contentLength, 10);
        if (!Number.isNaN(size) && size > MAX_MEDIA_SIZE) {
          console.warn(
            `[WhatsApp] downloadMedia skipped: content-length ${size} exceeds MAX_MEDIA_SIZE ${MAX_MEDIA_SIZE}`,
            { mediaId },
          );
          return null;
        }
      }

      const arrayBuf = await binRes.arrayBuffer();

      // Guard against oversized downloads when content-length was absent
      if (arrayBuf.byteLength > MAX_MEDIA_SIZE) {
        console.warn(
          `[WhatsApp] downloadMedia skipped: downloaded ${arrayBuf.byteLength} bytes exceeds MAX_MEDIA_SIZE ${MAX_MEDIA_SIZE}`,
          { mediaId },
        );
        return null;
      }
      return {
        data: Buffer.from(arrayBuf),
        mimeType:
          meta.mime_type ??
          binRes.headers.get('content-type') ??
          'application/octet-stream',
      };
    } catch (error) {
      console.error('[WhatsApp] downloadMedia failed:', mediaId, error);
      return null;
    }
  }

  // Dedup state
  const recentlySentIds = new Set<string>();
  const sentTimestamps = new Map<string, number>();

  function addRecentlySent(waMessageId: string): void {
    recentlySentIds.add(waMessageId);
    sentTimestamps.set(waMessageId, Date.now());

    // Lazy eviction
    const now = Date.now();
    for (const [id, ts] of sentTimestamps) {
      if (now - ts > EVICTION_TTL_MS) {
        recentlySentIds.delete(id);
        sentTimestamps.delete(id);
      }
    }
  }

  function isRecentlySent(waMessageId: string): boolean {
    const ts = sentTimestamps.get(waMessageId);
    if (!ts) return false;
    if (Date.now() - ts > EVICTION_TTL_MS) {
      recentlySentIds.delete(waMessageId);
      sentTimestamps.delete(waMessageId);
      return false;
    }
    return true;
  }

  // ─── Webhook verification ──────────────────────────────────────

  async function verifyWebhook(request: Request): Promise<boolean> {
    const signature = request.headers.get('x-hub-signature-256');
    if (!signature || signature.length === 0) return false;
    if (!signature.startsWith('sha256=')) return false;

    const rawBody = await request.clone().text();
    const expectedSig = crypto
      .createHmac('sha256', appSecret)
      .update(rawBody)
      .digest('hex');
    const expected = `sha256=${expectedSig}`;

    if (expected.length !== signature.length) return false;

    return crypto.timingSafeEqual(
      Buffer.from(expected),
      Buffer.from(signature),
    );
  }

  // ─── Webhook challenge (Meta GET verification) ─────────────────

  function handleWebhookChallenge(request: Request): Response | null {
    const url = new URL(request.url);
    const mode = url.searchParams.get('hub.mode');
    const token = url.searchParams.get('hub.verify_token');
    const challenge = url.searchParams.get('hub.challenge');

    // Verify the token matches what we configured in Meta dashboard
    const expectedToken = process.env.META_WEBHOOK_VERIFY_TOKEN;

    if (mode === 'subscribe' && challenge) {
      // If a verify token is configured, validate it. Otherwise accept any (dev mode).
      if (expectedToken && token !== expectedToken) {
        return new Response('Forbidden', { status: 403 });
      }
      return new Response(challenge, {
        status: 200,
        headers: { 'Content-Type': 'text/plain' },
      });
    }

    return null;
  }

  // ─── Webhook parsing ───────────────────────────────────────────

  async function parseWebhook(request: Request): Promise<ChannelEvent[]> {
    let payload: WebhookPayload;
    try {
      payload = (await request.clone().json()) as WebhookPayload;
    } catch {
      return [];
    }

    const events: ChannelEvent[] = [];

    if (!payload.entry?.length) return events;

    for (const entry of payload.entry) {
      for (const change of entry.changes) {
        const value = change.value;

        // Build contact name map
        const contactMap = new Map<string, string>();
        for (const c of value.contacts ?? []) {
          contactMap.set(c.wa_id, c.profile.name);
        }

        // Parse messages
        if (value.messages && value.messages.length > 0) {
          for (const msg of value.messages) {
            // Skip recently sent (dedup outbound echoes)
            if (isRecentlySent(msg.id)) continue;

            const event = await parseInboundMessage(msg, contactMap);
            if (event) events.push(event);
          }
        }

        // Parse statuses
        if (value.statuses && value.statuses.length > 0) {
          for (const status of value.statuses) {
            const event = parseStatus(status);
            events.push(event);
          }
        }
      }
    }

    return events;
  }

  async function parseInboundMessage(
    msg: InboundMessage,
    contactMap: Map<string, string>,
  ): Promise<ChannelEvent | null> {
    const base = {
      channel: 'whatsapp',
      from: msg.from,
      profileName: contactMap.get(msg.from) ?? '',
      messageId: msg.id,
      timestamp: Number.parseInt(msg.timestamp, 10) * 1000,
    };

    switch (msg.type) {
      case 'text': {
        return {
          type: 'message_received',
          ...base,
          content: msg.text?.body ?? '',
          messageType: 'text',
        } satisfies MessageReceivedEvent;
      }

      case 'image':
      case 'document':
      case 'audio':
      case 'video': {
        const mediaInfo =
          msg[msg.type as 'image' | 'document' | 'audio' | 'video'];
        let media: ChannelMedia[] | undefined;

        if (mediaInfo?.id) {
          const downloaded = await downloadMedia(mediaInfo.id);
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
        } satisfies MessageReceivedEvent;
      }

      case 'sticker': {
        const stickerInfo = msg.sticker;
        let media: ChannelMedia[] | undefined;

        if (stickerInfo?.id) {
          const downloaded = await downloadMedia(stickerInfo.id);
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
          metadata: { sticker: true },
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
          metadata: loc
            ? {
                location: {
                  latitude: loc.latitude,
                  longitude: loc.longitude,
                  name: loc.name,
                  address: loc.address,
                },
              }
            : undefined,
        } satisfies MessageReceivedEvent;
      }

      case 'contacts': {
        const contacts = msg.contacts;
        const firstContact = contacts?.[0];
        const content = firstContact?.name?.formatted_name ?? '';

        return {
          type: 'message_received',
          ...base,
          content,
          messageType: 'unsupported',
          metadata: contacts ? { contacts } : undefined,
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
            metadata: { buttonId: msg.interactive.button_reply.id },
          } satisfies MessageReceivedEvent;
        }
        if (msg.interactive?.list_reply) {
          return {
            type: 'message_received',
            ...base,
            content: msg.interactive.list_reply.title,
            messageType: 'list_reply',
            metadata: {
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
        } satisfies MessageReceivedEvent;
      }

      case 'button': {
        return {
          type: 'message_received',
          ...base,
          content: msg.button?.text ?? '',
          messageType: 'button_reply',
          metadata: { buttonPayload: msg.button?.payload },
        } satisfies MessageReceivedEvent;
      }

      default:
        return {
          type: 'message_received',
          ...base,
          content: '',
          messageType: 'unsupported',
        } satisfies MessageReceivedEvent;
    }
  }

  function parseStatus(status: InboundStatus): StatusUpdateEvent {
    return {
      type: 'status_update',
      channel: 'whatsapp',
      messageId: status.id,
      status:
        status.status === 'deleted' || status.status === 'warning'
          ? 'failed'
          : status.status,
      timestamp: Number.parseInt(status.timestamp, 10) * 1000,
      metadata: {
        ...(status.errors?.length ? { errors: status.errors } : {}),
        ...(status.status === 'deleted' ? { deleted: true } : {}),
        ...(status.status === 'warning' ? { warning: true } : {}),
      },
    };
  }

  // ─── Send ──────────────────────────────────────────────────────

  async function send(message: OutboundMessage): Promise<SendResult> {
    try {
      // Template message
      if (message.template) {
        return await sendTemplate(message);
      }

      // Interactive message
      if (message.metadata?.interactive) {
        return await sendInteractive(message);
      }

      // Media message
      if (message.media?.length) {
        return await sendMedia(message);
      }

      // Text message (with chunking)
      if (message.text !== undefined && message.text !== null) {
        if (message.text.length === 0) {
          return {
            success: false,
            error: 'Cannot send empty text message',
            retryable: false,
          };
        }
        return await sendText(message);
      }

      return { success: false, error: 'No content to send', retryable: false };
    } catch (err) {
      return errorToSendResult(err);
    }
  }

  async function sendText(message: OutboundMessage): Promise<SendResult> {
    const chunks = chunkText(message.text ?? '');
    let lastMessageId: string | undefined;

    for (const chunk of chunks) {
      const payload: Record<string, unknown> = {
        messaging_product: 'whatsapp',
        to: message.to,
        type: 'text',
        text: { body: chunk },
      };

      if (message.metadata?.replyToMessageId) {
        payload.context = { message_id: message.metadata.replyToMessageId };
      }

      const data = await graphFetch(`/${phoneNumberId}/messages`, {
        method: 'POST',
        body: JSON.stringify(payload),
      });

      lastMessageId = data.messages?.[0]?.id;
      if (lastMessageId) addRecentlySent(lastMessageId);
    }

    return { success: true, messageId: lastMessageId };
  }

  async function sendTemplate(message: OutboundMessage): Promise<SendResult> {
    const tmpl = message.template ?? { name: '', language: 'en' };
    const components = tmpl.parameters?.length
      ? [
          {
            type: 'body',
            parameters: tmpl.parameters.map((p) => ({ type: 'text', text: p })),
          },
        ]
      : undefined;

    const payload = {
      messaging_product: 'whatsapp',
      to: message.to,
      type: 'template',
      template: {
        name: tmpl.name,
        language: { code: tmpl.language },
        components,
      },
    };

    const data = await graphFetch(`/${phoneNumberId}/messages`, {
      method: 'POST',
      body: JSON.stringify(payload),
    });

    const messageId = data.messages?.[0]?.id;
    if (messageId) addRecentlySent(messageId);
    return { success: true, messageId };
  }

  async function sendInteractive(
    message: OutboundMessage,
  ): Promise<SendResult> {
    const payload = {
      messaging_product: 'whatsapp',
      to: message.to,
      type: 'interactive',
      interactive: message.metadata?.interactive,
    };

    const data = await graphFetch(`/${phoneNumberId}/messages`, {
      method: 'POST',
      body: JSON.stringify(payload),
    });

    const messageId = data.messages?.[0]?.id;
    if (messageId) addRecentlySent(messageId);
    return { success: true, messageId };
  }

  async function sendMedia(message: OutboundMessage): Promise<SendResult> {
    const item = message.media?.[0];
    if (!item) {
      return {
        success: false,
        error: 'No media item provided',
        retryable: false,
      };
    }
    const mediaType = item.type;

    const mediaPayload: Record<string, unknown> = {};

    if (item.url) {
      mediaPayload.link = item.url;
    } else if (item.data) {
      // Upload via Media API first
      const form = new FormData();
      form.append('messaging_product', 'whatsapp');
      form.append('type', item.mimeType ?? 'application/octet-stream');
      form.append(
        'file',
        new Blob([new Uint8Array(item.data)], {
          type: item.mimeType ?? 'application/octet-stream',
        }),
        item.filename ?? 'file',
      );

      const uploadRes = await fetch(
        graphUrl(apiVersion, `/${phoneNumberId}/media`),
        {
          method: 'POST',
          headers: { Authorization: `Bearer ${accessToken}` },
          body: form,
        },
      );
      if (!uploadRes.ok) {
        const body = await uploadRes.text();
        throw new WhatsAppApiError(
          `Media upload failed: ${body}`,
          uploadRes.status,
          0,
        );
      }
      const uploadData = (await uploadRes.json()) as { id: string };
      mediaPayload.id = uploadData.id;
    } else {
      return {
        success: false,
        error: 'Media item has neither url nor data',
        retryable: false,
      };
    }

    if (item.caption) {
      mediaPayload.caption = item.caption;
    }
    if (item.filename) {
      mediaPayload.filename = item.filename;
    }

    const payload: Record<string, unknown> = {
      messaging_product: 'whatsapp',
      to: message.to,
      type: mediaType,
      [mediaType]: mediaPayload,
    };

    if (message.metadata?.replyToMessageId) {
      payload.context = { message_id: message.metadata.replyToMessageId };
    }

    const data = await graphFetch(`/${phoneNumberId}/messages`, {
      method: 'POST',
      body: JSON.stringify(payload),
    });

    const messageId = data.messages?.[0]?.id;
    if (messageId) addRecentlySent(messageId);
    return { success: true, messageId };
  }

  // ─── Mark as read ──────────────────────────────────────────────

  async function markAsRead(messageId: string): Promise<void> {
    await graphFetch(`/${phoneNumberId}/messages`, {
      method: 'POST',
      body: JSON.stringify({
        messaging_product: 'whatsapp',
        status: 'read',
        message_id: messageId,
      }),
    });
  }

  // ─── Template sync ─────────────────────────────────────────────

  async function syncTemplates(): Promise<WhatsAppTemplate[]> {
    // wabaId is the entry.id from webhooks, but for template sync
    // we derive it from phoneNumberId by querying the phone number
    const phoneData = await graphFetch(`/${phoneNumberId}?fields=wabaId:owner`);
    const wabaId = phoneData.owner;

    if (!wabaId) {
      throw new Error('Could not determine WABA ID from phone number');
    }

    const data = await graphFetch(`/${wabaId}/message_templates?limit=100`);

    return (data.data ?? []).map((t) => {
      const tmpl = t as WhatsAppTemplate;
      return {
        id: tmpl.id,
        name: tmpl.name,
        language: tmpl.language,
        category: tmpl.category,
        status: tmpl.status,
        components: tmpl.components,
      };
    });
  }

  // ─── Error mapping ─────────────────────────────────────────────

  function errorToSendResult(err: unknown): SendResult {
    const message = err instanceof Error ? err.message : String(err);

    if (err instanceof WhatsAppApiError) {
      // Check mapped error codes
      const mapped = ERROR_CODE_MAP[err.code];
      if (mapped) {
        return {
          success: false,
          error: message,
          code: mapped.code,
          retryable: mapped.retryable,
        };
      }

      // 5xx HTTP status → server error
      if (err.httpStatus >= 500) {
        return {
          success: false,
          error: message,
          code: 'server_error',
          retryable: true,
        };
      }

      // Unknown code — default cautious: retryable
      return {
        success: false,
        error: message,
        code: 'unknown',
        retryable: true,
      };
    }

    // Non-API errors — default cautious: retryable
    return { success: false, error: message, code: 'unknown', retryable: true };
  }

  // ─── Capabilities ──────────────────────────────────────────────

  const capabilities: ChannelCapabilities = {
    templates: true,
    media: true,
    reactions: true,
    readReceipts: true,
    typingIndicators: false,
    streaming: false,
    messagingWindow: true,
  };

  return {
    name: 'whatsapp',
    inboundMode: 'push',
    capabilities,
    verifyWebhook,
    parseWebhook,
    handleWebhookChallenge,
    send,
    markAsRead,
    syncTemplates,
  };
}

// Re-export for testing
export { chunkText as _chunkText, ERROR_CODE_MAP as _ERROR_CODE_MAP };
