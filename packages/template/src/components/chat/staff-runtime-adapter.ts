import type {
  ExternalStoreAdapter,
  ThreadMessageLike,
} from '@assistant-ui/react';

import type {
  NormalizedMessage,
  NormalizedPart,
} from '@/lib/normalize-message';

type ContentPart = Exclude<ThreadMessageLike['content'], string>[number];

/** Convert a NormalizedPart to assistant-ui content parts */
function convertPart(part: NormalizedPart): ContentPart[] {
  // Text
  if (part.type === 'text') {
    return [{ type: 'text' as const, text: part.text ?? '' }];
  }

  // Reasoning
  if (part.type === 'reasoning') {
    return [
      { type: 'reasoning' as const, text: (part.reasoning as string) ?? '' },
    ];
  }

  // Source
  if (part.type === 'source') {
    return [
      {
        type: 'source' as const,
        sourceType: 'url' as const,
        id: (part.source as { url?: string })?.url ?? '',
        url: (part.source as { url?: string })?.url ?? '',
        title: (part.source as { title?: string })?.title,
      },
    ];
  }

  // Tool parts: type is `tool-${toolName}` — reverse-extract toolName
  if (part.type.startsWith('tool-')) {
    const toolName = part.type.slice(5);
    return [
      {
        type: 'tool-call' as const,
        toolCallId: (part.toolCallId as string) ?? `tc-${toolName}`,
        toolName,
        args: (part.input ?? {}) as never,
        result: part.output,
      },
    ];
  }

  // Dynamic tool
  if (part.type === 'dynamic-tool') {
    const toolName = (part.toolName as string) ?? 'unknown';
    return [
      {
        type: 'tool-call' as const,
        toolCallId: (part.toolCallId as string) ?? `tc-${toolName}`,
        toolName,
        args: (part.input ?? {}) as never,
        result: part.output,
      },
    ];
  }

  // Pass through unknown part types as text
  return [{ type: 'text' as const, text: part.text ?? '' }];
}

/** Convert a NormalizedMessage to ThreadMessageLike for assistant-ui */
function convertMessage(msg: NormalizedMessage): ThreadMessageLike {
  const content = msg.parts.flatMap(convertPart);

  return {
    role: msg.role,
    id: msg.id,
    createdAt: msg.createdAt ? new Date(msg.createdAt) : undefined,
    content:
      content.length > 0 ? content : [{ type: 'text' as const, text: '' }],
  };
}

/** Create adapter options for useExternalStoreRuntime (read-only staff view) */
export function createStaffAdapter(
  messages: NormalizedMessage[],
): ExternalStoreAdapter<NormalizedMessage> {
  return {
    messages,
    convertMessage,
    isRunning: false,
    onNew: async () => {},
    isDisabled: true,
  };
}
