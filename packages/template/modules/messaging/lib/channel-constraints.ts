/**
 * Per-channel constraint configuration for card rendering and validation.
 *
 * Used by the sendCard tool at validation time and injected into agent
 * system prompts so the agent can tailor card structure per channel.
 */

interface ChannelConstraints {
  /** Maximum number of interactive buttons. null = unlimited. */
  maxButtons: number | null;
  maxButtonLabelLength: number;
  maxBodyLength: number;
  supportsMarkdown: boolean;
  name: string;
  supportsLists: boolean;
  /** Maximum number of list items across all sections. null = unlimited. */
  maxListItems: number | null;
  supportsMedia: ('image' | 'document' | 'audio' | 'video')[];
  supportsTemplates: boolean;
  supportsReactions: boolean;
  supportsReadReceipts: boolean;
  /** Messaging window in hours after last user message. null = no window limit. */
  messagingWindowHours: number | null;
  supportsTypingIndicators: boolean;
  /** Idle window in ms — resolved conversations within this window can be reopened. */
  idleWindowMs: number;
}

export const CHANNEL_CONSTRAINTS: Record<string, ChannelConstraints> = {
  whatsapp: {
    maxButtons: 3,
    maxButtonLabelLength: 20,
    maxBodyLength: 1024,
    supportsMarkdown: false,
    name: 'WhatsApp',
    supportsLists: true,
    maxListItems: 10,
    supportsMedia: ['image', 'document', 'audio', 'video'],
    supportsTemplates: true,
    supportsReactions: true,
    supportsReadReceipts: true,
    messagingWindowHours: 24,
    supportsTypingIndicators: false,
    idleWindowMs: 86_400_000, // 24h
  },
  web: {
    maxButtons: null,
    maxButtonLabelLength: 100,
    maxBodyLength: 10000,
    supportsMarkdown: true,
    name: 'Web',
    supportsLists: false,
    maxListItems: null,
    supportsMedia: ['image', 'document'],
    supportsTemplates: false,
    supportsReactions: true,
    supportsReadReceipts: false,
    messagingWindowHours: null,
    supportsTypingIndicators: true,
    idleWindowMs: 1_800_000, // 30min
  },
  email: {
    maxButtons: null,
    maxButtonLabelLength: 100,
    maxBodyLength: 50000,
    supportsMarkdown: true,
    name: 'Email',
    supportsLists: false,
    maxListItems: null,
    supportsMedia: ['image', 'document'],
    supportsTemplates: false,
    supportsReactions: false,
    supportsReadReceipts: false,
    messagingWindowHours: null,
    supportsTypingIndicators: false,
    idleWindowMs: 259_200_000, // 72h
  },
  telegram: {
    maxButtons: 8,
    maxButtonLabelLength: 64,
    maxBodyLength: 4096,
    supportsMarkdown: true,
    name: 'Telegram',
    supportsLists: false,
    maxListItems: null,
    supportsMedia: ['image', 'document', 'audio', 'video'],
    supportsTemplates: false,
    supportsReactions: true,
    supportsReadReceipts: true,
    messagingWindowHours: null,
    supportsTypingIndicators: true,
    idleWindowMs: 86_400_000, // 24h (same as WhatsApp)
  },
};

/** Get constraints for a channel, falling back to web defaults for unknown channels. */
export function getConstraints(channel: string): ChannelConstraints {
  return CHANNEL_CONSTRAINTS[channel] ?? CHANNEL_CONSTRAINTS.web;
}

/** Format channel constraints as a human-readable string for agent system prompt injection. */
export function formatConstraintsForPrompt(channel: string): string {
  const c = getConstraints(channel);
  const parts: string[] = [`Channel constraints for ${c.name}:`];
  if (c.maxButtons !== null) {
    parts.push(`- Maximum ${c.maxButtons} interactive buttons per card`);
  } else {
    parts.push('- Unlimited buttons supported');
  }
  parts.push(`- Button labels: max ${c.maxButtonLabelLength} characters`);
  parts.push(`- Message body: max ${c.maxBodyLength} characters`);
  parts.push(
    `- Markdown: ${c.supportsMarkdown ? 'supported' : 'not supported — use plain text'}`,
  );
  parts.push(
    `- Interactive lists: ${c.supportsLists ? `supported (max ${c.maxListItems} items)` : 'not supported — use plain text fallback'}`,
  );
  if (c.supportsMedia.length > 0) {
    parts.push(`- Media types supported: ${c.supportsMedia.join(', ')}`);
  } else {
    parts.push('- No media types supported');
  }
  parts.push(
    `- Templates: ${c.supportsTemplates ? 'supported' : 'not supported'}`,
  );
  parts.push(
    `- Reactions: ${c.supportsReactions ? 'supported' : 'not supported'}`,
  );
  parts.push(
    `- Read receipts: ${c.supportsReadReceipts ? 'supported' : 'not supported'}`,
  );
  if (c.messagingWindowHours !== null) {
    parts.push(
      `- Messaging window: ${c.messagingWindowHours}h after last user message`,
    );
  } else {
    parts.push('- Messaging window: none');
  }
  parts.push(
    `- Typing indicators: ${c.supportsTypingIndicators ? 'supported' : 'not supported'}`,
  );
  return parts.join('\n');
}
