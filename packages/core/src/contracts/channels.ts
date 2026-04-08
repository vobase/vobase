/**
 * Channel adapter contracts for bidirectional messaging.
 * Replaces the notify module — handles both transactional (one-way)
 * and conversational (bidirectional) messaging through channel adapters.
 */

// ─── Channel Adapter ────────────────────────────────────────────────

export interface ChannelAdapter {
  name: string;
  inboundMode: 'push' | 'pull' | 'both';
  capabilities: ChannelCapabilities;

  /** Push inbound: verify webhook signature */
  verifyWebhook?(request: Request): Promise<boolean>;
  /** Push inbound: parse webhook payload into normalized events */
  parseWebhook?(request: Request): Promise<ChannelEvent[]>;
  /**
   * Push inbound: handle Meta/WhatsApp webhook verification challenges.
   *
   * Meta sends a GET request to the webhook URL during setup with `hub.mode`,
   * `hub.verify_token`, and `hub.challenge` query params. The adapter should
   * verify the token and echo back `hub.challenge` with a 200 response, or
   * return `null` if the request does not match a known challenge format.
   */
  handleWebhookChallenge?(request: Request): Response | null;

  /** Pull inbound: poll for new messages since a given timestamp */
  poll?(since: Date): Promise<ChannelEvent[]>;
  /** Pull inbound: interval in ms (default 60000) */
  pollInterval?: number;

  /** Outbound: send a message via this channel. Never throws — returns SendResult. */
  send(message: OutboundMessage): Promise<SendResult>;

  /** One-time setup (called during module init) */
  initialize?(): Promise<void>;
  /** Health check for monitoring */
  healthCheck?(): Promise<{ ok: boolean; error?: string }>;

  /** Extract a channel instance identifier from an inbound webhook payload.
   *  Used when the webhook URL doesn't include an instanceId param
   *  (e.g. Messenger/Instagram where Meta sends all events to one URL). */
  extractInstanceIdentifier?(payload: unknown): string | null;

  /** Adapter-specific outbound serialization (template, interactive, media routing). */
  serializeOutbound?(message: {
    content: string;
    contentData: unknown;
  }): OutboundMessage;

  /** Format text for channel (e.g. WhatsApp markdown, email HTML wrapping). */
  renderContent?(text: string): string;

  /** Whether messages go through delivery queue or are instant (web). */
  deliveryModel?: 'queued' | 'realtime';

  /** Which contact field to use for outbound addressing. */
  contactIdentifierField?: 'phone' | 'email' | 'identifier';

  /** Per-channel debounce window in ms (WhatsApp: 3000, Email: 30000, Web: 0). */
  debounceWindowMs?: number;

  /** Format session state for agent prompt injection. */
  getSessionContext?(session: {
    windowExpiresAt: Date | null;
    sessionState: string | null;
  }): string | null;
}

export interface ChannelCapabilities {
  templates: boolean;
  media: boolean;
  reactions: boolean;
  readReceipts: boolean;
  typingIndicators: boolean;
  streaming: boolean;
  messagingWindow: boolean;
}

// ─── Inbound Events ─────────────────────────────────────────────────

export type ChannelEvent =
  | MessageReceivedEvent
  | StatusUpdateEvent
  | ReactionEvent;

export interface MessageReceivedEvent {
  type: 'message_received';
  channel: string;
  from: string;
  profileName: string;
  messageId: string;
  content: string;
  messageType:
    | 'text'
    | 'image'
    | 'document'
    | 'audio'
    | 'video'
    | 'reaction'
    | 'button_reply'
    | 'list_reply'
    | 'unsupported';
  timestamp: number;
  /** Eagerly downloaded media — WhatsApp URLs expire in ~5 minutes */
  media?: ChannelMedia[];
  /** Channel-specific extra data */
  metadata?: Record<string, unknown>;
  /** Resolved channel instance ID (from URL param or adapter extraction) */
  channelInstanceId?: string;
}

export interface ChannelMedia {
  type: 'image' | 'document' | 'audio' | 'video';
  data: Buffer;
  mimeType: string;
  filename?: string;
}

export interface StatusUpdateEvent {
  type: 'status_update';
  channel: string;
  messageId: string;
  status: 'sent' | 'delivered' | 'read' | 'failed';
  timestamp: number;
  metadata?: Record<string, unknown>;
}

export interface ReactionEvent {
  type: 'reaction';
  channel: string;
  from: string;
  messageId: string;
  emoji: string;
  action?: 'add' | 'remove';
  timestamp: number;
}

// ─── Outbound Messages ──────────────────────────────────────────────

export interface OutboundMessage {
  to: string;
  /** Text content */
  text?: string;
  /** Template message (WhatsApp) */
  template?: {
    name: string;
    language: string;
    /** Legacy: body text parameters only */
    parameters?: string[];
    /** Full component parameters (header, body, button). Takes precedence over parameters. */
    components?: Array<{
      type: 'header' | 'body' | 'button';
      sub_type?: 'quick_reply' | 'url';
      index?: number;
      parameters: Array<
        | { type: 'text'; text: string }
        | {
            type: 'currency';
            currency: {
              fallback_value: string;
              code: string;
              amount_1000: number;
            };
          }
        | { type: 'date_time'; date_time: { fallback_value: string } }
        | { type: 'image'; image: { link?: string; id?: string } }
        | {
            type: 'document';
            document: { link?: string; id?: string; filename?: string };
          }
        | { type: 'video'; video: { link?: string; id?: string } }
      >;
    }>;
  };
  /** Media attachments */
  media?: OutboundMedia[];
  /** Email HTML body */
  html?: string;
  /** Email subject */
  subject?: string;
  /** Channel-specific options (WhatsApp: replyToMessageId, email: cc/bcc) */
  metadata?: Record<string, unknown>;
}

export interface OutboundMedia {
  type: 'image' | 'document' | 'audio' | 'video';
  /** Public URL (WhatsApp can fetch directly) */
  url?: string;
  /** Raw bytes (email attachments) */
  data?: Buffer;
  filename?: string;
  /** WhatsApp image/video caption */
  caption?: string;
  mimeType?: string;
}

// ─── Send Result ────────────────────────────────────────────────────

export interface SendResult {
  success: boolean;
  /** Provider's message ID */
  messageId?: string;
  /** Human-readable error */
  error?: string;
  /** Machine-readable: 'rate_limited', 'invalid_recipient', 'window_expired', 'template_rejected' */
  code?: string;
  /** Hint: should the caller retry? */
  retryable?: boolean;
}
