import type { UIMessage } from 'ai';

// ─── Types ──────────────────────────────────────────────────────────────

/** Content shapes from Mastra memory messages */
type MemoryMessageContent =
  | string
  | { type: string; text?: string; [key: string]: unknown }[]
  | {
      format: number;
      parts: { type: string; [key: string]: unknown }[];
      metadata?: Record<string, unknown>;
    };

export interface MemoryMessage {
  id: string;
  role: string;
  content: MemoryMessageContent;
  createdAt?: string;
  deliveryStatus?: string;
}

export interface NormalizedPart {
  type: string;
  text?: string;
  [key: string]: unknown;
}

interface NormalizedMessageMetadata {
  visibility?: 'internal' | 'public';
  isStaffReply?: boolean;
  staffName?: string;
  deliveryStatus?: string;
  /** Activity event type (system messages only) */
  activityType?: string;
  /** Additional activity event data */
  activityData?: Record<string, unknown>;
}

export interface NormalizedMessage {
  id: string;
  role: 'user' | 'assistant' | 'system';
  parts: NormalizedPart[];
  createdAt?: string;
  metadata: NormalizedMessageMetadata;
}

// ─── Core Helpers ──────────────────────────────────────────────────────

/** Extract plain text from any MemoryMessage content shape. */
export function extractText(content: MemoryMessageContent): string {
  if (typeof content === 'string') return content;
  if (Array.isArray(content)) {
    return content
      .filter((p) => p.type === 'text' && p.text)
      .map((p) => (p.text as string) ?? '')
      .join('');
  }
  if (content && typeof content === 'object' && 'parts' in content) {
    return (content as { parts: { type: string; text?: string }[] }).parts
      .filter((p) => p.type === 'text' && p.text)
      .map((p) => p.text ?? '')
      .join('');
  }
  return '';
}

/** Convert a Mastra memory part to UI-compatible parts. */
export function convertMemoryPart(part: {
  type: string;
  [key: string]: unknown;
}): NormalizedPart[] {
  if (part.type === 'text') {
    return [{ type: 'text', text: part.text as string }];
  }
  // Mastra native format: { type: 'tool-call', toolName, args, result }
  if (part.type === 'tool-call') {
    const toolName = part.toolName as string;
    const hasResult = part.result !== undefined;
    return [
      {
        type: `tool-${toolName}`,
        toolCallId: part.toolCallId as string | undefined,
        state: hasResult ? 'output-available' : 'input-available',
        input: part.args,
        ...(hasResult ? { output: part.result } : {}),
      },
    ];
  }
  // AI SDK v5 format: { type: 'tool-invocation', toolInvocation: { toolName, state, ... } }
  if (part.type === 'tool-invocation' && part.toolInvocation) {
    const inv = part.toolInvocation as {
      toolName: string;
      toolCallId?: string;
      state: string;
      args?: unknown;
      result?: unknown;
    };
    const hasResult = inv.state === 'result' || inv.result !== undefined;
    return [
      {
        type: `tool-${inv.toolName}`,
        toolCallId: inv.toolCallId,
        state: hasResult ? 'output-available' : 'input-available',
        input: inv.args,
        ...(hasResult ? { output: inv.result } : {}),
      },
    ];
  }
  return [part];
}

/** Normalize MemoryMessage content into flat parts array. */
export function getMessageParts(
  content: MemoryMessageContent,
): NormalizedPart[] {
  if (typeof content === 'string') {
    return content ? [{ type: 'text', text: content }] : [];
  }
  if (Array.isArray(content)) {
    return content.flatMap((p) =>
      convertMemoryPart(p as { type: string; [key: string]: unknown }),
    );
  }
  if (content && typeof content === 'object' && 'parts' in content) {
    return (
      content as { parts: { type: string; [key: string]: unknown }[] }
    ).parts.flatMap((p) => convertMemoryPart(p));
  }
  return [];
}

// ─── Metadata Detection ─────────────────────────────────────────────────

const STAFF_REGEX = /^\[Staff:\s*(.+?)\]\s*/;
const INTERNAL_REGEX = /^\[Internal\]/i;

/** Check if text starts with [Staff: ...] prefix */
function hasStaffPrefix(text: string): boolean {
  return STAFF_REGEX.test(text);
}

/** Extract staff name from [Staff: Name] prefix, or null if not present. */
export function extractStaffName(text: string): string | null {
  const match = text.match(STAFF_REGEX);
  return match ? match[1] : null;
}

/** Extract metadata from message content's metadata field (format v2). */
function extractContentMetadata(
  content: MemoryMessageContent,
): Record<string, unknown> | undefined {
  if (
    content &&
    typeof content === 'object' &&
    !Array.isArray(content) &&
    'metadata' in content
  ) {
    return (content as { metadata?: Record<string, unknown> }).metadata;
  }
  return undefined;
}

/**
 * Detect staff reply: check metadata.isStaffReply first, fall back to [Staff: Name] regex.
 */
export function detectStaffReply(msg: NormalizedMessage): {
  isStaffReply: boolean;
  staffName: string | null;
} {
  if (msg.metadata.isStaffReply) {
    return {
      isStaffReply: true,
      staffName: msg.metadata.staffName ?? null,
    };
  }
  const text = msg.parts
    .filter((p) => p.type === 'text')
    .map((p) => p.text ?? '')
    .join('');
  const match = text.match(STAFF_REGEX);
  if (match) {
    return { isStaffReply: true, staffName: match[1] };
  }
  return { isStaffReply: false, staffName: null };
}

/**
 * Detect internal note: check metadata.visibility first, fall back to [Internal] text prefix.
 */
export function isInternalNote(msg: NormalizedMessage): boolean {
  if (msg.metadata.visibility === 'internal') return true;
  const text = msg.parts
    .filter((p) => p.type === 'text')
    .map((p) => p.text ?? '')
    .join('');
  return INTERNAL_REGEX.test(text);
}

// ─── Normalizers ────────────────────────────────────────────────────────

/** Normalize a UIMessage into NormalizedMessage. */
export function normalizeUIMessage(msg: UIMessage): NormalizedMessage {
  const parts: NormalizedPart[] = msg.parts.flatMap((part) => {
    if (part.type === 'text') {
      return [{ type: 'text', text: part.text }];
    }
    // AI SDK v5 tool-invocation format (from Mastra memory after refresh)
    if (part.type === 'tool-invocation') {
      return convertMemoryPart(
        part as { type: string; [key: string]: unknown },
      );
    }
    // Mastra native tool-call format
    if (part.type === 'tool-call') {
      return convertMemoryPart(
        part as { type: string; [key: string]: unknown },
      );
    }
    // AI SDK v6 tool parts: type is `tool-${toolName}`, with direct state/input/output
    if (part.type.startsWith('tool-')) {
      const toolPart = part as {
        type: string;
        toolCallId: string;
        state: string;
        input?: unknown;
        output?: unknown;
        [key: string]: unknown;
      };
      return [
        {
          type: toolPart.type,
          toolCallId: toolPart.toolCallId,
          state:
            toolPart.state === 'result' || toolPart.state === 'output-available'
              ? 'output-available'
              : 'input-streaming',
          input: toolPart.input,
          ...(toolPart.output !== undefined ? { output: toolPart.output } : {}),
        },
      ];
    }
    // dynamic-tool, file, reasoning, etc. — pass through
    return [part as NormalizedPart];
  });

  // Detect staff reply from text prefix
  const textContent = parts
    .filter((p) => p.type === 'text')
    .map((p) => p.text ?? '')
    .join('');
  const staffMatch = textContent.match(STAFF_REGEX);
  const metadata: NormalizedMessageMetadata = {};
  if (staffMatch) {
    metadata.isStaffReply = true;
    metadata.staffName = staffMatch[1];
  }

  return {
    id: msg.id,
    role: msg.role === 'user' ? 'user' : 'assistant',
    parts,
    metadata,
  };
}

/**
 * Normalize a MemoryMessage (from Mastra) into NormalizedMessage.
 * Dual-read: checks content.metadata first, falls back to [Staff:]/[Internal] text prefix.
 */
export function normalizeMemoryMessage(msg: MemoryMessage): NormalizedMessage {
  const parts = getMessageParts(msg.content);
  const contentMeta = extractContentMetadata(msg.content);

  const metadata: NormalizedMessageMetadata = {
    deliveryStatus: msg.deliveryStatus,
  };

  if (contentMeta) {
    if (contentMeta.visibility === 'internal') {
      metadata.visibility = 'internal';
    }
    if (contentMeta.isStaffReply) {
      metadata.isStaffReply = true;
      metadata.staffName = contentMeta.staffName as string | undefined;
    }
  }

  return {
    id: msg.id,
    role: msg.role === 'user' ? 'user' : 'assistant',
    parts,
    createdAt: msg.createdAt,
    metadata,
  };
}
