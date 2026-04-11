import type {
  InputProcessor,
  ProcessInputArgs,
  ProcessInputResult,
} from '@mastra/core/processors';

interface ModerationConfig {
  /** Literal strings to block. Case-insensitive matching. */
  blocklist?: string[];
  /** Maximum allowed message length in characters. */
  maxLength?: number;
}

/** Info passed to the onBlock callback when content is moderated. */
export interface ModerationBlockInfo {
  reason: 'blocklist' | 'max_length';
  content: string;
  matchedTerm?: string;
}

/** Callback invoked when the moderation processor blocks content. */
export type OnBlockCallback = (info: ModerationBlockInfo) => void;

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
    return {
      ...(originalContent as Record<string, unknown>),
      parts: [{ type: 'text', text: MODERATION_NOTICE }],
    };
  }
  return MODERATION_NOTICE;
}

/**
 * Content moderation input processor with TripWire pattern.
 *
 * When content is blocked:
 * 1. Calls abort() with retry=true to trigger a TripWire
 * 2. The agent framework retries the generation with the moderated (replaced) content
 * 3. On retry, the moderated message passes through without triggering again
 *
 * This ensures the agent always sees the moderation notice and responds
 * appropriately, rather than silently replacing content.
 */
export function createModerationProcessor(
  config?: ModerationConfig,
  onBlock?: OnBlockCallback,
): InputProcessor {
  const blocklist = (config?.blocklist ?? []).map((s) => s.toLowerCase());
  const maxLength = config?.maxLength ?? DEFAULT_MAX_LENGTH;

  const safeOnBlock = (info: ModerationBlockInfo) => {
    if (!onBlock) return;
    try {
      onBlock(info);
    } catch {
      // Logging failure must not prevent moderation
    }
  };

  return {
    id: 'content-moderation',

    async processInput(args: ProcessInputArgs): Promise<ProcessInputResult> {
      const { messages, abort, retryCount } = args;
      const lastMessage = messages[messages.length - 1];
      if (!lastMessage || lastMessage.role !== 'user') {
        return messages;
      }

      const content = extractText(lastMessage.content);

      // Check blocklist
      const lowerContent = content.toLowerCase();
      const matchedTerm = blocklist.find((term) => lowerContent.includes(term));
      if (matchedTerm) {
        safeOnBlock({ reason: 'blocklist', content, matchedTerm });

        // On retry: the TripWire feedback is already in the message history,
        // replace the blocked content with a moderation notice and continue
        if (retryCount > 0) {
          return [
            ...messages.slice(0, -1),
            {
              ...lastMessage,
              content: buildModeratedContent(lastMessage.content),
            },
          ] as typeof messages;
        }

        // First attempt: abort with retry (TripWire) — framework retries with feedback
        abort(`Content blocked: matched term "${matchedTerm}"`, {
          retry: true,
          metadata: { reason: 'blocklist', matchedTerm },
        });
      }

      // Check max length
      if (content.length > maxLength) {
        safeOnBlock({ reason: 'max_length', content });

        if (retryCount > 0) {
          return [
            ...messages.slice(0, -1),
            {
              ...lastMessage,
              content: buildModeratedContent(lastMessage.content),
            },
          ] as typeof messages;
        }

        abort(
          `Content blocked: exceeds max length (${content.length} > ${maxLength})`,
          {
            retry: true,
            metadata: { reason: 'max_length' },
          },
        );
      }

      return messages;
    },
  };
}

export { extractText, MODERATION_NOTICE };
