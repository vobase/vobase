import type {
  InputProcessor,
  ProcessInputArgs,
  ProcessInputResult,
} from '@mastra/core/processors';

export interface ModerationConfig {
  /** Literal strings to block. Case-insensitive matching. */
  blocklist?: string[];
  /** Maximum allowed message length in characters. */
  maxLength?: number;
}

const DEFAULT_MAX_LENGTH = 10_000;

const MODERATION_NOTICE =
  '[Content moderated: message blocked by content policy]';

/** Extract text content from a MastraDBMessage regardless of content format. */
function extractText(content: unknown): string {
  if (typeof content === 'string') return content;
  if (content && typeof content === 'object' && 'parts' in content) {
    const parts = (content as { parts: Array<{ type: string; text?: string }> })
      .parts;
    return parts
      .filter((p) => p.type === 'text' && p.text)
      .map((p) => p.text)
      .join('');
  }
  return JSON.stringify(content);
}

/** Build a moderation notice in the same content format as the original message. */
function buildModeratedContent(originalContent: unknown): unknown {
  if (
    originalContent &&
    typeof originalContent === 'object' &&
    'format' in originalContent
  ) {
    // V2 format — replace parts with moderation notice
    return {
      ...(originalContent as Record<string, unknown>),
      parts: [{ type: 'text', text: MODERATION_NOTICE }],
    };
  }
  // Fallback — return as string (V1 format)
  return MODERATION_NOTICE;
}

/**
 * Content moderation input processor.
 * Pure text-based moderation — literal blocklist + length check. No LLM call.
 *
 * When content is blocked, replaces the user message with a moderation notice.
 * The agent then responds naturally to the notice (e.g., "I can't help with that.").
 *
 * Blocklist entries are matched as case-insensitive literal substrings to avoid
 * ReDoS attacks from user-supplied patterns.
 */
export function createModerationProcessor(
  config?: ModerationConfig,
): InputProcessor {
  const blocklist = (config?.blocklist ?? []).map((s) => s.toLowerCase());
  const maxLength = config?.maxLength ?? DEFAULT_MAX_LENGTH;

  return {
    id: 'content-moderation',

    async processInput(args: ProcessInputArgs): Promise<ProcessInputResult> {
      const { messages } = args;
      const lastMessage = messages[messages.length - 1];
      if (!lastMessage || lastMessage.role !== 'user') {
        return messages;
      }

      const content = extractText(lastMessage.content);

      // Check blocklist (case-insensitive literal substring matching)
      const lowerContent = content.toLowerCase();
      const blocked = blocklist.some((term) => lowerContent.includes(term));
      if (blocked) {
        return [
          ...messages.slice(0, -1),
          {
            ...lastMessage,
            content: buildModeratedContent(lastMessage.content),
          },
        ] as typeof messages;
      }

      // Check max length
      if (content.length > maxLength) {
        return [
          ...messages.slice(0, -1),
          {
            ...lastMessage,
            content: buildModeratedContent(lastMessage.content),
          },
        ] as typeof messages;
      }

      return messages;
    },
  };
}

export { MODERATION_NOTICE, extractText };
