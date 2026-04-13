import crypto from 'node:crypto';

import type {
  ChannelAdapter,
  ChannelCapabilities,
  ChannelEvent,
  OutboundMessage,
  SendResult,
  StatusUpdateEvent,
} from '../../../contracts/channels';
import type { HttpClient } from '../../../infra/http-client';
import { logger } from '../../../infra/logger';
import type { WhatsAppChannelConfig } from '../index';
import {
  parseWhatsAppMessages,
  parseWhatsAppStatuses,
  shouldUpdateStatus,
} from './whatsapp-shared';
import type { WhatsAppWebhookPayload } from './whatsapp-shared';

// ─── Types ───────────────────────────────────────────────────────────

export interface WhatsAppTemplate {
  id: string;
  name: string;
  language: string;
  category: string;
  status: string;
  components: unknown[];
}

/** CTA URL interactive message type for pass-through to the Graph API. */
export interface WhatsAppCtaUrlInteractive {
  type: 'cta_url';
  body: { text: string };
  action: { name: 'cta_url'; parameters: { display_text: string; url: string } };
}

/** Input for creating a WhatsApp message template via the Graph API. */
export interface CreateTemplateInput {
  name: string;
  language: string;
  category: 'MARKETING' | 'UTILITY' | 'AUTHENTICATION';
  components: Array<{ type: 'HEADER' | 'BODY' | 'FOOTER' | 'BUTTONS'; [key: string]: unknown }>;
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
const MAX_MAP_SIZE = 10_000;
const MEDIA_SIZE_LIMITS: Record<string, number> = {
  image: 5 * 1024 * 1024, // 5MB
  video: 16 * 1024 * 1024, // 16MB
  audio: 16 * 1024 * 1024, // 16MB
  document: 100 * 1024 * 1024, // 100MB
  sticker: 500 * 1024, // 500KB (animated max)
};
const DEFAULT_MEDIA_SIZE_LIMIT = 25 * 1024 * 1024; // 25MB fallback

// ─── Error Code Map ──────────────────────────────────────────────────

const ERROR_CODE_MAP: Record<number, { code: string; retryable: boolean }> = {
  190: { code: 'invalid_token', retryable: false },
  130429: { code: 'rate_limited', retryable: true },
  130472: { code: 'experiment_blocked', retryable: false },
  131026: { code: 'message_undeliverable', retryable: false },
  131030: { code: 'invalid_recipient', retryable: false },
  131042: { code: 'business_eligibility_payment', retryable: false },
  131047: { code: 'window_expired', retryable: false },
  131048: { code: 'spam_rate_limited', retryable: true },
  131049: { code: 'meta_chose_not_to_deliver', retryable: false },
  131050: { code: 'opted_out', retryable: false },
  131051: { code: 'unsupported_type', retryable: false },
  131056: { code: 'pair_rate_limited', retryable: true },
  132000: { code: 'template_param_mismatch', retryable: false },
  132001: { code: 'template_not_exist', retryable: false },
  132005: { code: 'template_hydrated_too_long', retryable: false },
  132012: { code: 'template_not_found', retryable: false },
  132015: { code: 'template_paused', retryable: false },
  132068: { code: 'flow_blocked', retryable: false },
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
        const e =
          typeof parsed.error === 'object' && parsed.error !== null
            ? parsed.error
            : { message: typeof parsed.error === 'string' ? parsed.error : undefined };
        throw new WhatsAppApiError(
          e.message ?? `WhatsApp API ${res.status}: ${body.slice(0, 200)}`,
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
  healthCheck(): Promise<{ ok: boolean; error?: string }>;
  checkWebhookSubscription(): Promise<{ subscribed: boolean; callbackUrl?: string; error?: string }>;
  tokenStatus(): { valid: boolean; expiresAt?: Date; daysRemaining?: number };
  createTemplate(template: CreateTemplateInput): Promise<{ id: string; status: string }>;
  deleteTemplate(name: string): Promise<void>;
  getTemplate(name: string): Promise<WhatsAppTemplate | null>;
  getMessagingTier(): Promise<{ tier: string; qualityRating: string }>;
  registerWebhook(callbackUrl: string, verifyToken: string): Promise<void>;
  deregisterWebhook(): Promise<void>;
} {
  const { phoneNumberId, accessToken, appSecret } = config;
  const apiVersion = config.apiVersion ?? 'v22.0';
  const transport = config.transport;

  // ─── transportFetch closure ─────────────────────────────────

  /**
   * Centralized fetch that routes through the transport proxy when configured,
   * or directly to the Meta Graph API otherwise. All outbound calls go through this.
   */
  async function transportFetch(
    path: string,
    init: RequestInit = {},
  ): Promise<Response> {
    const url = transport
      ? `${transport.baseUrl}${path}`
      : graphUrl(apiVersion, path);

    // Sign the full URL pathname so it matches what the platform's
    // verifyTenantSignature middleware sees via c.req.path.
    const authHeaders = transport
      ? transport.signRequest(init.method ?? 'GET', new URL(url).pathname)
      : { Authorization: `Bearer ${accessToken}` };

    const res = await fetch(url, {
      ...init,
      headers: { ...authHeaders, ...(init.headers as Record<string, string>) },
    });

    // Intercept proxy-layer errors before they reach parseGraphError
    if (transport && (res.status === 502 || res.status === 503 || res.status === 504)) {
      const body = await res.text().catch(() => '');
      throw new WhatsAppApiError(
        `Platform proxy ${res.status}: ${body.slice(0, 200) || 'no body'}`,
        res.status,
        0,
      );
    }

    return res;
  }

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
    // Transport mode: always use transportFetch (skip httpClient — its retry/circuit
    // breaker is calibrated for direct Meta API, not the proxy hop)
    if (transport) {
      const res = await transportFetch(path, {
        ...options,
        headers: {
          'Content-Type': 'application/json',
          ...(options.headers as Record<string, string>),
        },
      });
      if (!res.ok) {
        await parseGraphError(res);
      }
      return res.json() as Promise<GraphApiResponse>;
    }

    // Direct mode: existing behavior
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
    mediaType?: string,
  ): Promise<{ data: Buffer; mimeType: string } | null> {
    const MAX_RETRIES = 2;
    for (let attempt = 0; attempt <= MAX_RETRIES; attempt++) {
      try {
        const maxSize: number =
          (mediaType ? MEDIA_SIZE_LIMITS[mediaType] : undefined) ??
          DEFAULT_MEDIA_SIZE_LIMIT;

        let binRes: Response;
        let mimeTypeHint: string | undefined;

        if (transport) {
          // Transport mode: platform handles media resolution + download.
          // The platform's media-download endpoint accepts either:
          //   ?mediaId= (platform resolves CDN URL using its access token)
          //   ?url= (pre-resolved CDN URL, for when graph proxy allows /{mediaId})
          //
          // Try graph proxy first for CDN URL resolution; if blocked (403),
          // fall back to passing mediaId directly to media-download endpoint.
          let downloadUrl: string;
          try {
            const meta = await graphFetch(`/${mediaId}`);
            const mediaUrl = meta.url as string;
            if (!mediaUrl) return null;
            mimeTypeHint = meta.mime_type as string | undefined;
            downloadUrl = `${transport.mediaDownloadUrl}?url=${encodeURIComponent(mediaUrl)}`;
          } catch {
            // Graph proxy blocked /{mediaId} — pass mediaId to media-download
            downloadUrl = `${transport.mediaDownloadUrl}?mediaId=${encodeURIComponent(mediaId)}`;
          }
          const authHeaders = transport.signRequest(
            'GET',
            new URL(downloadUrl).pathname,
          );
          binRes = await fetch(downloadUrl, { headers: authHeaders });
        } else {
          // Direct mode: two-step — fetch metadata for CDN URL, then download binary
          const meta = await graphFetch(`/${mediaId}`);
          const mediaUrl = meta.url as string;
          if (!mediaUrl) return null;
          mimeTypeHint = meta.mime_type as string | undefined;

          binRes = await fetch(mediaUrl, {
            headers: { Authorization: `Bearer ${accessToken}` },
          });
        }
        if (!binRes.ok) return null;

        // Check content-length before downloading to enforce size limit
        const contentLength = binRes.headers.get('content-length');
        if (contentLength !== null) {
          const size = Number.parseInt(contentLength, 10);
          if (!Number.isNaN(size) && size > maxSize) {
            console.warn(
              `[WhatsApp] downloadMedia skipped: content-length ${size} exceeds limit ${maxSize}`,
              { mediaId, mediaType },
            );
            return null;
          }
        }

        const arrayBuf = await binRes.arrayBuffer();

        // Guard against oversized downloads when content-length was absent
        if (arrayBuf.byteLength > maxSize) {
          console.warn(
            `[WhatsApp] downloadMedia skipped: downloaded ${arrayBuf.byteLength} bytes exceeds limit ${maxSize}`,
            { mediaId, mediaType },
          );
          return null;
        }
        return {
          data: Buffer.from(arrayBuf),
          mimeType:
            mimeTypeHint ??
            binRes.headers.get('content-type') ??
            'application/octet-stream',
        };
      } catch (error) {
        if (attempt === MAX_RETRIES) {
          console.error('[WhatsApp] downloadMedia failed after retries:', mediaId, error);
          return null;
        }
        console.warn('[WhatsApp] downloadMedia retry:', { mediaId, attempt: attempt + 1 });
        await new Promise<void>((resolve) => setTimeout(resolve, 1_000));
      }
    }
    return null;
  }

  /**
   * In-memory dedup: tracks recently sent message IDs for 60s to filter
   * outbound echoes from inbound webhooks. This state is lost on server
   * restart — the outbox table's status column prevents duplicate sends
   * at the DB level, so this is a secondary performance optimization only.
   */
  const sentTimestamps = new Map<string, number>();

  function addRecentlySent(waMessageId: string): void {
    sentTimestamps.set(waMessageId, Date.now());

    // Lazy eviction
    const now = Date.now();
    for (const [id, ts] of sentTimestamps) {
      if (now - ts > EVICTION_TTL_MS) {
        sentTimestamps.delete(id);
      }
    }
  }

  function isRecentlySent(waMessageId: string): boolean {
    const ts = sentTimestamps.get(waMessageId);
    if (!ts) return false;
    if (Date.now() - ts > EVICTION_TTL_MS) {
      sentTimestamps.delete(waMessageId);
      return false;
    }
    return true;
  }

  // ─── Status dedup (inbound status webhook deduplication) ──────────
  // Tracks (messageId:status) -> timestamp for 60s TTL dedup.
  // Distinct from sentTimestamps (which deduplicates outbound echo messages).
  const statusDedup = new Map<string, number>();

  let lastEviction = 0;
  function evictStaleEntries(map: Map<string, number | { ts: number }>): void {
    const now = Date.now();
    if (now - lastEviction < 5_000) return; // evict at most every 5s
    lastEviction = now;
    for (const [k, v] of map) {
      const ts = typeof v === 'number' ? v : v.ts;
      if (now - ts > EVICTION_TTL_MS) map.delete(k);
    }
  }

  function isStatusDuplicate(messageId: string, status: string): boolean {
    const key = `${messageId}:${status}`;
    const now = Date.now();

    evictStaleEntries(statusDedup);

    if (statusDedup.has(key)) return true; // duplicate within TTL

    // Cap at maxSize: drop oldest when full
    if (statusDedup.size >= MAX_MAP_SIZE) {
      const firstKey = statusDedup.keys().next().value;
      if (firstKey) statusDedup.delete(firstKey);
    }

    statusDedup.set(key, now);
    return false;
  }

  // ─── Status high-water (out-of-order rejection) ────────────────────
  // Performance optimization only — the authoritative ordering guard is the
  // DB-level shouldUpdateStatus() check in the template's handleStatusUpdate.
  // This in-memory map avoids a DB round-trip on the hot path but is volatile
  // (lost on restart) and process-local (not safe for multi-instance).
  const statusHighWater = new Map<string, { status: string; ts: number }>();

  function getHighWater(messageId: string): string | null {
    const entry = statusHighWater.get(messageId);
    if (!entry) return null;
    if (Date.now() - entry.ts > EVICTION_TTL_MS) {
      statusHighWater.delete(messageId);
      return null;
    }
    return entry.status;
  }

  function setHighWater(messageId: string, status: string): void {
    if (statusHighWater.size >= MAX_MAP_SIZE) {
      let oldestTs = Infinity;
      let oldestKey = '';
      for (const [k, v] of statusHighWater) {
        if (v.ts < oldestTs) {
          oldestTs = v.ts;
          oldestKey = k;
        }
      }
      if (oldestKey) statusHighWater.delete(oldestKey);
    }
    statusHighWater.set(messageId, { status, ts: Date.now() });
  }

  // ─── Webhook verification ──────────────────────────────────────

  async function verifyWebhook(request: Request): Promise<boolean> {
    // Transport mode: webhooks arrive via platform forwarding, which verifies
    // X-Hub-Signature-256 before forwarding with X-Platform-Signature. The core
    // webhook router in channels/index.ts verifies X-Platform-Signature BEFORE
    // calling this method. This adapter MUST NOT be called without prior platform
    // signature verification.
    if (transport) return true;

    const signature = request.headers.get('x-hub-signature-256');
    if (!signature || signature.length === 0) return false;
    if (!signature.startsWith('sha256=')) return false;

    const rawBody = await request.clone().text();
    const expectedSig = crypto
      .createHmac('sha256', appSecret)
      .update(rawBody)
      .digest('hex');
    const expected = `sha256=${expectedSig}`;

    try {
      return crypto.timingSafeEqual(
        Buffer.from(expected),
        Buffer.from(signature),
      );
    } catch {
      return false; // length mismatch throws
    }
  }

  // ─── Webhook challenge (Meta GET verification) ─────────────────

  function handleWebhookChallenge(request: Request): Response | null {
    const url = new URL(request.url);
    const mode = url.searchParams.get('hub.mode');
    const token = url.searchParams.get('hub.verify_token');
    const challenge = url.searchParams.get('hub.challenge');

    // Verify the token matches what we configured (config first, env fallback)
    const expectedToken =
      config.webhookVerifyToken ?? process.env.META_WEBHOOK_VERIFY_TOKEN;

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
    let payload: WhatsAppWebhookPayload;
    try {
      payload = (await request.clone().json()) as WhatsAppWebhookPayload;
    } catch {
      return [];
    }

    if (payload.object !== 'whatsapp_business_account') return [];

    // ── Parallel media pre-fetch ───────────────────────────────────────
    // Scan payload to collect all media IDs, download in parallel via
    // Promise.allSettled (with retry built into downloadMedia), then serve
    // from cache — parseWhatsAppMessages makes no extra network calls.
    const mediaFetchList: Array<{ msgId: string; mediaId: string; mediaType: string }> = [];
    for (const entry of payload.entry) {
      for (const change of entry.changes) {
        for (const msg of change.value.messages ?? []) {
          for (const mtype of ['image', 'document', 'audio', 'video', 'sticker'] as const) {
            const mediaId = msg[mtype]?.id;
            if (mediaId) {
              mediaFetchList.push({ msgId: msg.id, mediaId, mediaType: mtype });
              break; // one media type per message
            }
          }
        }
      }
    }

    const downloadSettled = await Promise.allSettled(
      mediaFetchList.map(({ mediaId, mediaType }) => downloadMedia(mediaId, mediaType)),
    );

    // Build cache and track failures by mediaId
    const mediaCache = new Map<string, { data: Buffer; mimeType: string } | null>();
    const failedMediaIds = new Set<string>();
    for (let i = 0; i < mediaFetchList.length; i++) {
      const { mediaId } = mediaFetchList[i];
      const settled = downloadSettled[i];
      const value = settled.status === 'fulfilled' ? settled.value : null;
      mediaCache.set(mediaId, value);
      if (!value) failedMediaIds.add(mediaId);
    }

    // messageId -> mediaId for post-processing failure metadata
    const msgToMediaId = new Map(mediaFetchList.map(({ msgId, mediaId }) => [msgId, mediaId]));

    // Cached downloader: serves pre-fetched results, no extra network calls
    const cachedDownloader = async (mediaId: string) => mediaCache.get(mediaId) ?? null;

    const messageEvents = await parseWhatsAppMessages(payload, cachedDownloader);

    // Post-process: add mediaDownloadFailed metadata where download failed
    const processedMessages: ChannelEvent[] = [];
    for (const e of messageEvents) {
      if (e.type === 'message_received') {
        const mediaId = msgToMediaId.get(e.messageId);
        if (mediaId && failedMediaIds.has(mediaId)) {
          processedMessages.push({
            ...e,
            metadata: { ...e.metadata, mediaDownloadFailed: true, failedMediaId: mediaId },
          });
          continue;
        }
      }
      processedMessages.push(e);
    }

    // Outbound echo dedup filter (isRecentlySent is adapter-specific, not shared logic)
    const dedupedMessages = processedMessages.filter(
      (e) => e.type !== 'message_received' || !isRecentlySent(e.messageId),
    );

    const statusEvents = parseWhatsAppStatuses(payload);

    // Status dedup: drop identical (messageId, status) pairs within 60s TTL.
    // Runs BEFORE ordering filter to prevent duplicates from corrupting the high-water mark.
    const dedupedStatuses = statusEvents.filter((e) => {
      if (e.type !== 'status_update') return true;
      return !isStatusDuplicate(e.messageId, e.status);
    });

    // Status ordering: reject out-of-order updates using per-message high-water mark
    const orderedStatuses = dedupedStatuses.filter((e) => {
      if (e.type !== 'status_update') return true;
      const current = getHighWater(e.messageId);
      if (shouldUpdateStatus(current, e.status)) {
        setHighWater(e.messageId, e.status);
        return true;
      }
      console.warn('[whatsapp] Status out-of-order filtered', {
        messageId: e.messageId,
        current,
        incoming: e.status,
      });
      return false;
    });

    // Template status updates: field='message_template_status_update'
    // Emitted as StatusUpdateEvent with metadata.templateStatusUpdate=true.
    // Bypass dedup/ordering — these are template-level events, not message delivery.
    const templateStatusEvents: ChannelEvent[] = [];
    for (const entry of payload.entry) {
      for (const change of entry.changes) {
        if (change.field !== 'message_template_status_update') continue;
        const v = change.value as unknown as Record<string, unknown>;
        const event = v.event as string | undefined;
        const templateName = v.message_template_name as string | undefined;
        const templateId = v.message_template_id as number | string | undefined;
        if (!event || !templateName) continue;
        const mappedStatus: StatusUpdateEvent['status'] =
          event === 'REJECTED' || event === 'PAUSED' ? 'failed' : 'delivered';
        templateStatusEvents.push({
          type: 'status_update',
          channel: 'whatsapp',
          messageId: String(templateId ?? templateName),
          status: mappedStatus,
          timestamp: Date.now(),
          metadata: {
            templateStatusUpdate: true,
            templateName,
            templateStatus: event,
          },
        } satisfies StatusUpdateEvent);
      }
    }

    return [...dedupedMessages, ...orderedStatuses, ...templateStatusEvents];
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
        text: { body: chunk, preview_url: /https?:\/\//.test(chunk) },
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
    // Prefer structured components over legacy text parameters
    const components = tmpl.components?.length
      ? tmpl.components
      : tmpl.parameters?.length
        ? [
            {
              type: 'body',
              parameters: tmpl.parameters.map((p) => ({
                type: 'text',
                text: p,
              })),
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
    if (!message.media?.length) {
      return {
        success: false,
        error: 'No media item provided',
        retryable: false,
      };
    }

    let lastMessageId: string | undefined;

    for (const item of message.media) {
      const mediaType = item.type;
      const mediaPayload: Record<string, unknown> = {};

      if (item.url) {
        mediaPayload.link = item.url;
      } else if (item.data) {
        const maxSize =
          MEDIA_SIZE_LIMITS[mediaType] ?? DEFAULT_MEDIA_SIZE_LIMIT;
        if (item.data.length > maxSize) {
          return {
            success: false,
            error: `Media size ${item.data.length} exceeds ${mediaType} limit of ${maxSize} bytes`,
            retryable: false,
          };
        }
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

        const uploadRes = await transportFetch(`/${phoneNumberId}/media`, {
          method: 'POST',
          body: form,
        });
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

      lastMessageId = data.messages?.[0]?.id;
      if (lastMessageId) addRecentlySent(lastMessageId);
    }

    return { success: true, messageId: lastMessageId };
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

  // ─── WABA ID lookup (shared by template operations) ───────────────

  let cachedWabaId: string | null = null;
  async function getWabaId(): Promise<string> {
    if (cachedWabaId) return cachedWabaId;
    const phoneData = await graphFetch(`/${phoneNumberId}?fields=owner`);
    const wabaId = phoneData.owner;
    if (!wabaId) throw new Error('Could not determine WABA ID from phone number');
    cachedWabaId = wabaId as string;
    return cachedWabaId;
  }

  // ─── Template sync ─────────────────────────────────────────────

  async function syncTemplates(): Promise<WhatsAppTemplate[]> {
    const wabaId = await getWabaId();
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

  // ─── Health check + token status ───────────────────────────────

  async function checkWebhookSubscription(): Promise<{
    subscribed: boolean;
    callbackUrl?: string;
    error?: string;
  }> {
    if (transport) return { subscribed: true }; // managed by platform
    if (!config.appId) {
      return { subscribed: true }; // can't check without appId, assume ok
    }

    try {
      const data = await graphFetch(`/${config.appId}/subscriptions`);
      const subscriptions = data.data as
        | Array<{
            object: string;
            callback_url: string;
            active: boolean;
            fields: Array<{ name: string; version: string }>;
          }>
        | undefined;

      const wabaSub = subscriptions?.find(
        (s) => s.object === 'whatsapp_business_account',
      );

      if (!wabaSub) {
        return {
          subscribed: false,
          error: 'Webhook not subscribed — no whatsapp_business_account subscription found on this app',
        };
      }

      if (!wabaSub.active) {
        return {
          subscribed: false,
          callbackUrl: wabaSub.callback_url,
          error: 'Webhook subscription exists but is not active',
        };
      }

      const hasMessages = wabaSub.fields?.some((f) => f.name === 'messages');
      if (!hasMessages) {
        return {
          subscribed: false,
          callbackUrl: wabaSub.callback_url,
          error: 'Webhook subscription is missing the "messages" field',
        };
      }

      return { subscribed: true, callbackUrl: wabaSub.callback_url };
    } catch (err) {
      // Don't fail the health check for subscription check errors — warn and move on
      logger.warn('[WhatsApp] Could not verify webhook subscription', {
        appId: config.appId,
        error: err instanceof Error ? err.message : err,
      });
      return {
        subscribed: true,
        error: `Could not verify webhook subscription: ${err instanceof Error ? err.message : 'Unknown error'}`,
      };
    }
  }

  async function healthCheck(): Promise<{ ok: boolean; error?: string }> {
    if (transport) return { ok: true }; // managed by platform in transport mode

    const now = new Date();
    if (config.tokenExpiresAt) {
      const expiresAt = config.tokenExpiresAt;
      if (expiresAt <= now) return { ok: false, error: 'Token expired' };
      const daysRemaining = Math.ceil(
        (expiresAt.getTime() - now.getTime()) / (1000 * 60 * 60 * 24),
      );
      if (daysRemaining <= 7) {
        return {
          ok: true,
          error: `Token expires in ${daysRemaining} day${daysRemaining === 1 ? '' : 's'}`,
        };
      }
    } else {
      // No tokenExpiresAt: make a lightweight API call to verify token validity
      try {
        await graphFetch(`/${phoneNumberId}?fields=id`);
      } catch (err) {
        if (err instanceof WhatsAppApiError && err.code === 190) {
          return { ok: false, error: 'Invalid token' };
        }
        return { ok: false, error: err instanceof Error ? err.message : 'Unknown error' };
      }
    }

    // Token is valid — now check webhook subscription
    const subCheck = await checkWebhookSubscription();
    if (!subCheck.subscribed) {
      return { ok: false, error: subCheck.error ?? 'Webhook not subscribed' };
    }
    if (subCheck.error) {
      // Warning-level (subscribed: true but with a note)
      return { ok: true, error: subCheck.error };
    }

    return { ok: true };
  }

  function tokenStatus(): { valid: boolean; expiresAt?: Date; daysRemaining?: number } {
    if (!config.tokenExpiresAt) return { valid: true };
    const now = new Date();
    const expiresAt = config.tokenExpiresAt;
    const expired = expiresAt <= now;
    const msRemaining = expiresAt.getTime() - now.getTime();
    const daysRemaining = expired ? 0 : Math.ceil(msRemaining / (1000 * 60 * 60 * 24));
    return { valid: !expired, expiresAt, daysRemaining };
  }

  // ─── Template CRUD (direct mode only) ─────────────────────────

  const TEMPLATE_NAME_RE = /^[a-z0-9_]+$/;
  const TEMPLATE_MAX_CHARS = 512;
  const TEMPLATE_MAX_BUTTONS = 10;

  async function createTemplate(
    template: CreateTemplateInput,
  ): Promise<{ id: string; status: string }> {
    if (!TEMPLATE_NAME_RE.test(template.name)) {
      throw new Error(
        `Invalid template name "${template.name}": must match ^[a-z0-9_]+$`,
      );
    }
    const bodyComponent = template.components.find((c) => c.type === 'BODY');
    if (!bodyComponent) {
      throw new Error('Template must have at least one BODY component');
    }
    const bodyText = (bodyComponent.text as string | undefined) ?? '';
    if (bodyText.length > TEMPLATE_MAX_CHARS) {
      throw new Error(
        `Template body text (${bodyText.length} chars) exceeds maximum of ${TEMPLATE_MAX_CHARS}`,
      );
    }
    const buttonsComponent = template.components.find((c) => c.type === 'BUTTONS');
    if (buttonsComponent) {
      const buttons = buttonsComponent.buttons;
      if (Array.isArray(buttons) && buttons.length > TEMPLATE_MAX_BUTTONS) {
        throw new Error(
          `Template has ${buttons.length} buttons; maximum is ${TEMPLATE_MAX_BUTTONS}`,
        );
      }
    }

    const wabaId = await getWabaId();
    const data = await graphFetch(`/${wabaId}/message_templates`, {
      method: 'POST',
      body: JSON.stringify({
        name: template.name,
        language: template.language,
        category: template.category,
        components: template.components,
      }),
    });
    return { id: data.id as string, status: data.status as string };
  }

  async function deleteTemplate(name: string): Promise<void> {
    const wabaId = await getWabaId();
    await graphFetch(
      `/${wabaId}/message_templates?name=${encodeURIComponent(name)}`,
      { method: 'DELETE' },
    );
  }

  async function getTemplate(name: string): Promise<WhatsAppTemplate | null> {
    const wabaId = await getWabaId();
    try {
      const data = await graphFetch(
        `/${wabaId}/message_templates?name=${encodeURIComponent(name)}&fields=id,name,language,category,status,components`,
      );
      const templates = data.data as WhatsAppTemplate[] | undefined;
      return templates?.[0] ?? null;
    } catch {
      return null;
    }
  }

  // ─── Messaging tier (direct mode only) ────────────────────────

  async function getMessagingTier(): Promise<{ tier: string; qualityRating: string }> {
    const data = await graphFetch(
      `/${phoneNumberId}?fields=messaging_limit_tier,quality_rating`,
    );
    return {
      tier: (data.messaging_limit_tier as string | undefined) ?? 'unknown',
      qualityRating: (data.quality_rating as string | undefined) ?? 'unknown',
    };
  }

  // ─── Webhook subscription (direct mode, requires appId) ────────

  async function registerWebhook(callbackUrl: string, verifyToken: string): Promise<void> {
    if (!config.appId) {
      throw new Error('appId is required in WhatsAppChannelConfig to register webhooks');
    }
    await graphFetch(`/${config.appId}/subscriptions`, {
      method: 'POST',
      body: JSON.stringify({
        object: 'whatsapp_business_account',
        callback_url: callbackUrl,
        verify_token: verifyToken,
        fields: 'messages',
      }),
    });
  }

  async function deregisterWebhook(): Promise<void> {
    if (!config.appId) {
      throw new Error('appId is required in WhatsAppChannelConfig to deregister webhooks');
    }
    await graphFetch(
      `/${config.appId}/subscriptions?object=whatsapp_business_account`,
      { method: 'DELETE' },
    );
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
    contactIdentifierField: 'phone',
    capabilities,
    verifyWebhook,
    parseWebhook,
    handleWebhookChallenge,
    send,
    markAsRead,
    syncTemplates,
    healthCheck,
    checkWebhookSubscription,
    tokenStatus,
    createTemplate,
    deleteTemplate,
    getTemplate,
    getMessagingTier,
    registerWebhook,
    deregisterWebhook,
    extractInstanceIdentifier(payload: unknown): string | null {
      try {
        const p = payload as WhatsAppWebhookPayload;
        return (
          p?.entry?.[0]?.changes?.[0]?.value?.metadata?.phone_number_id ?? null
        );
      } catch {
        return null;
      }
    },
  };
}

// Re-export for testing
export { chunkText as _chunkText, ERROR_CODE_MAP as _ERROR_CODE_MAP };
