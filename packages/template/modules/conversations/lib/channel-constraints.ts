/**
 * Per-channel constraint configuration for card rendering and validation.
 *
 * Used by the sendCard tool at validation time and injected into agent
 * system prompts so the agent can tailor card structure per channel.
 */

export interface ChannelConstraints {
  /** Maximum number of interactive buttons. null = unlimited. */
  maxButtons: number | null;
  maxButtonLabelLength: number;
  maxBodyLength: number;
  supportsMarkdown: boolean;
  name: string;
}

export const CHANNEL_CONSTRAINTS: Record<string, ChannelConstraints> = {
  whatsapp: {
    maxButtons: 3,
    maxButtonLabelLength: 20,
    maxBodyLength: 1024,
    supportsMarkdown: false,
    name: 'WhatsApp',
  },
  web: {
    maxButtons: null,
    maxButtonLabelLength: 100,
    maxBodyLength: 10000,
    supportsMarkdown: true,
    name: 'Web',
  },
  telegram: {
    maxButtons: 8,
    maxButtonLabelLength: 64,
    maxBodyLength: 4096,
    supportsMarkdown: true,
    name: 'Telegram',
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
  return parts.join('\n');
}
