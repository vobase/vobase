/**
 * Bridge adapter — wraps core ChannelAdapter into a chat-sdk Adapter.
 *
 * Core _channels owns transport (webhooks, security, logging, templates, media).
 * This bridge translates chat-sdk's conversation model into core's send/receive.
 */
import type { MessageReceivedEvent, Scheduler, VobaseDb } from '@vobase/core';
import type {
  Adapter,
  AdapterPostableMessage,
  ChatInstance,
  EmojiValue,
  FetchOptions,
  FetchResult,
  FormattedContent,
  Message,
  MessageData,
  RawMessage,
  ThreadInfo,
  WebhookOptions,
} from 'chat';
import { Message as ChatMessage, isCardElement, stringifyMarkdown } from 'chat';

import { enqueueMessage } from './outbox';

// ─── Types ───────────────────────────────────────────────────────────

interface BridgeDeps {
  db: VobaseDb;
  scheduler: Scheduler;
}

// ─── Factory ─────────────────────────────────────────────────────────

/** Channel instance record shape (subset of schema). */
interface ChannelInstanceRecord {
  id: string;
  type: string;
  label: string;
}

/** Wrap a core ChannelAdapter into a chat-sdk Adapter for use with Chat instance. */
export function createChannelBridge(
  channelInstance: ChannelInstanceRecord,
  deps: BridgeDeps,
): Adapter<string, Record<string, unknown>> {
  let _chat: ChatInstance | null = null;
  const instanceId = channelInstance.id;
  const channelType = channelInstance.type;

  const adapter: Adapter<string, Record<string, unknown>> = {
    name: instanceId,
    userName: channelInstance.label,

    async initialize(chat: ChatInstance): Promise<void> {
      _chat = chat;
    },

    // ─── Message posting ───────────────────────────────────────────

    async postMessage(
      threadId: string,
      message: AdapterPostableMessage,
    ): Promise<RawMessage<Record<string, unknown>>> {
      const { content, payload } = serializeForChannel(message);

      const record = await enqueueMessage(deps.db, deps.scheduler, {
        conversationId: threadId,
        content,
        channelType,
        channelInstanceId: instanceId,
        payload,
      });

      return { id: record.id, threadId, raw: {} };
    },

    // ─── Message parsing ───────────────────────────────────────────

    parseMessage(
      raw: Record<string, unknown>,
    ): Message<Record<string, unknown>> {
      const event = raw as unknown as MessageReceivedEvent;
      const data: MessageData<Record<string, unknown>> = {
        id: event.messageId,
        threadId: '', // Set by caller via processMessage
        text: event.content,
        formatted: {
          type: 'root',
          children: [
            {
              type: 'paragraph',
              children: [{ type: 'text', value: event.content }],
            },
          ],
        },
        author: {
          userId: event.from,
          userName: event.profileName || event.from,
          fullName: event.profileName || event.from,
          isBot: false,
          isMe: false,
        },
        raw: raw as Record<string, unknown>,
        attachments: [],
        metadata: {
          dateSent: new Date(event.timestamp),
          edited: false,
        },
      };
      return new ChatMessage(data);
    },

    // ─── Thread identity (AD-2: session ID = thread ID) ────────────

    encodeThreadId(platformData: string): string {
      return platformData;
    },

    decodeThreadId(threadId: string): string {
      return threadId;
    },

    channelIdFromThreadId(_threadId: string): string {
      return instanceId;
    },

    isDM(_threadId: string): boolean {
      return true;
    },

    // ─── Formatting ────────────────────────────────────────────────

    renderFormatted(content: FormattedContent): string {
      // Convert mdast AST to WhatsApp-compatible text (*bold*, _italic_)
      return stringifyMarkdown(content);
    },

    persistMessageHistory: true,

    // ─── Not used — core owns webhooks ─────────────────────────────

    async handleWebhook(
      _request: Request,
      _options?: WebhookOptions,
    ): Promise<Response> {
      throw new Error('Not used — core owns webhooks');
    },

    // ─── Not supported ─────────────────────────────────────────────

    async editMessage(
      _threadId: string,
      _messageId: string,
      _message: AdapterPostableMessage,
    ): Promise<RawMessage<Record<string, unknown>>> {
      throw new Error('Not supported');
    },

    async deleteMessage(_threadId: string, _messageId: string): Promise<void> {
      throw new Error('Not supported');
    },

    // ─── No-ops ────────────────────────────────────────────────────

    async fetchMessages(
      _threadId: string,
      _options?: FetchOptions,
    ): Promise<FetchResult<Record<string, unknown>>> {
      return { messages: [] };
    },

    async fetchThread(_threadId: string): Promise<ThreadInfo> {
      return { id: _threadId, channelId: instanceId, metadata: {} };
    },

    async addReaction(
      _threadId: string,
      _messageId: string,
      _emoji: EmojiValue | string,
    ): Promise<void> {
      // No-op
    },

    async removeReaction(
      _threadId: string,
      _messageId: string,
      _emoji: EmojiValue | string,
    ): Promise<void> {
      // No-op
    },

    async startTyping(_threadId: string, _status?: string): Promise<void> {
      // No-op
    },
  };

  return adapter;
}

// ─── Serialization ─────────────────────────────────────────────────

interface SerializedOutput {
  content: string;
  payload?:
    | {
        template?: { name: string; language: string; parameters?: string[] };
        interactive?: Record<string, unknown>;
      }
    | undefined;
}

/** Serialize AdapterPostableMessage → outbox content + optional structured payload. */
function serializeForChannel(
  message: AdapterPostableMessage,
): SerializedOutput {
  // Plain string
  if (typeof message === 'string') {
    return { content: message };
  }

  // CardElement — structured output (templates, interactive buttons)
  if (isCardElement(message)) {
    return serializeCard(message);
  }

  // PostableCard wrapper
  if (typeof message === 'object' && message !== null && 'card' in message) {
    return serializeCard(message.card);
  }

  // PostableMarkdown
  if (
    typeof message === 'object' &&
    message !== null &&
    'markdown' in message
  ) {
    return { content: message.markdown };
  }

  // PostableAst
  if (typeof message === 'object' && message !== null && 'ast' in message) {
    return { content: stringifyMarkdown(message.ast) };
  }

  // PostableRaw
  if (typeof message === 'object' && message !== null && 'raw' in message) {
    return { content: message.raw };
  }

  return {
    content:
      typeof message === 'string' ? message : JSON.stringify(message ?? ''),
  };
}

/** Serialize a CardElement to outbox content + payload. */
export function serializeCard(card: unknown): SerializedOutput {
  const cardObj = card as Record<string, unknown>;

  // CardElement is a plain object: { type: 'card', title?, children, metadata? }
  // metadata.template is set by buildTemplateCard()
  const metadata = (cardObj.metadata ?? {}) as Record<string, unknown>;

  // Card with template metadata → WhatsApp template
  if (metadata.template) {
    const tmpl = metadata.template as {
      name: string;
      language: string;
      parameters?: string[];
    };
    return {
      content: `[Template: ${tmpl.name}]`,
      payload: { template: tmpl },
    };
  }

  // Card with action buttons → WhatsApp interactive reply buttons
  const children = (cardObj.children ?? []) as unknown[];
  const buttons = extractActionButtons(children);

  if (buttons.length > 0 && buttons.length <= 3) {
    const interactive = {
      type: 'button',
      body: { text: extractCardText(cardObj) },
      action: {
        buttons: buttons.map((btn) => ({
          type: 'reply',
          reply: {
            id: btn.id,
            title: String(btn.title).slice(0, 20),
          },
        })),
      },
    };
    return {
      content: cardToTextFallback(cardObj, buttons),
      payload: { interactive },
    };
  }

  // Card without usable buttons → text fallback
  return { content: cardToTextFallback(cardObj, buttons) };
}

// ─── Card helpers ──────────────────────────────────────────────────

interface ButtonInfo {
  id: string;
  title: string;
}

/** Extract action buttons from card children. */
function extractActionButtons(children: unknown[]): ButtonInfo[] {
  const buttons: ButtonInfo[] = [];
  for (const child of children) {
    if (!child || typeof child !== 'object') continue;
    const el = child as Record<string, unknown>;
    const type = el.type as string | undefined;

    // ActionsElement: { type: 'actions', children: ButtonElement[] }
    if (type === 'actions') {
      const actionChildren = (el.children ?? []) as unknown[];
      for (const btn of actionChildren) {
        if (!btn || typeof btn !== 'object') continue;
        const btnEl = btn as Record<string, unknown>;
        if (btnEl.type === 'button' && btnEl.id) {
          buttons.push({
            id: String(btnEl.id),
            title: String(btnEl.label ?? ''),
          });
        }
      }
    }

    // Direct ButtonElement: { type: 'button', id, label }
    if (type === 'button' && el.id) {
      buttons.push({
        id: String(el.id),
        title: String(el.label ?? ''),
      });
    }
  }
  return buttons;
}

/** Extract readable text from card (title + text children). */
function extractCardText(cardObj: Record<string, unknown>): string {
  const parts: string[] = [];
  const title = cardObj.title as string | undefined;
  if (title) parts.push(title);

  // Extract text from TextElement children
  const children = (cardObj.children ?? []) as unknown[];
  for (const child of children) {
    if (!child || typeof child !== 'object') continue;
    const el = child as Record<string, unknown>;
    if (el.type === 'text' && el.content) {
      parts.push(String(el.content));
    }
  }
  return parts.join('\n') || '';
}

function cardToTextFallback(
  cardObj: Record<string, unknown>,
  buttons: ButtonInfo[],
): string {
  const parts: string[] = [];
  const text = extractCardText(cardObj);
  if (text) parts.push(text);
  if (buttons.length > 0) {
    parts.push('');
    for (const btn of buttons) {
      parts.push(`• ${btn.title}`);
    }
  }
  return parts.join('\n');
}
