// ─── Config ──────────────────────────────────────────────────────────

export interface WhatsAppTransportConfig {
  /** Base URL for Graph API proxy. */
  baseUrl: string;
  /** URL for binary media downloads. */
  mediaDownloadUrl: string;
  /** Returns headers to include in proxied requests (HMAC signature + tenant ID). */
  signRequest: (method: string, path: string) => Record<string, string>;
}

export interface WhatsAppChannelConfig {
  phoneNumberId: string;
  accessToken: string;
  appSecret: string;
  apiVersion?: string;
  webhookVerifyToken?: string;
  /** When set, routes all Graph API calls through a proxy instead of calling Meta directly. */
  transport?: WhatsAppTransportConfig;
  /** When the access token expires. Used by healthCheck() to warn before expiry (≤7 days). */
  tokenExpiresAt?: Date;
  /** App ID for webhook subscription management via registerWebhook/deregisterWebhook. */
  appId?: string;
}

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

export const MAX_TEXT_LENGTH = 4096;
export const EVICTION_TTL_MS = 60_000;
export const MAX_MAP_SIZE = 10_000;
export const MEDIA_SIZE_LIMITS: Record<string, number> = {
  image: 5 * 1024 * 1024, // 5MB
  video: 16 * 1024 * 1024, // 16MB
  audio: 16 * 1024 * 1024, // 16MB
  document: 100 * 1024 * 1024, // 100MB
  sticker: 500 * 1024, // 500KB (animated max)
};
export const DEFAULT_MEDIA_SIZE_LIMIT = 25 * 1024 * 1024; // 25MB fallback

// ─── Error Code Map ──────────────────────────────────────────────────

export const ERROR_CODE_MAP: Record<number, { code: string; retryable: boolean }> = {
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

// ─── Template Validation Constants ───────────────────────────────────

export const TEMPLATE_NAME_RE = /^[a-z0-9_]+$/;
export const TEMPLATE_MAX_CHARS = 512;
export const TEMPLATE_MAX_BUTTONS = 10;
