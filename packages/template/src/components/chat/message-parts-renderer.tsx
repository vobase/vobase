import type { ToolUIPart } from 'ai';
import type { CardElement } from 'chat';

import { CardRenderer } from '@/components/ai-elements/card-renderer';
import { MessageResponse } from '@/components/ai-elements/message';
import { ToolCallPart } from './tool-call-part';

interface MessagePartsRendererProps {
  parts: Array<{ type: string; text?: string; [key: string]: unknown }>;
  messageId: string;
  onAction?: (actionId: string, value?: string) => void;
  readOnly?: boolean;
  /** Pass true for the currently streaming assistant message */
  isStreaming?: boolean;
}

/** Extract tool name from any tool part format */
function getToolNameFromPart(part: {
  type: string;
  [key: string]: unknown;
}): string | undefined {
  // DynamicToolUIPart: type='dynamic-tool', toolName='send_card'
  if (part.type === 'dynamic-tool') return part.toolName as string;
  // StaticToolUIPart: type='tool-send_card'
  if (part.type.startsWith('tool-')) return part.type.slice(5);
  return undefined;
}

/** Extract card data from tool output, handling various shapes */
function extractCardFromOutput(output: unknown): CardElement | null {
  if (!output || typeof output !== 'object') return null;
  const obj = output as Record<string, unknown>;
  // Tool returns { card: CardElement }
  if ('card' in obj && obj.card && typeof obj.card === 'object') {
    const card = obj.card as Record<string, unknown>;
    if (card.type === 'card') return card as unknown as CardElement;
  }
  // Tool returns CardElement directly
  if (obj.type === 'card' && 'children' in obj) {
    return obj as unknown as CardElement;
  }
  return null;
}

export function MessagePartsRenderer({
  parts,
  messageId,
  onAction,
  readOnly,
  isStreaming,
}: MessagePartsRendererProps) {
  // Find the last text part index for streaming animation
  const lastTextIdx = isStreaming
    ? parts.findLastIndex((p) => p.type === 'text')
    : -1;

  return (
    <>
      {parts.map((part, partIdx) => {
        if (part.type === 'text') {
          const isActiveStream = partIdx === lastTextIdx;
          return (
            // biome-ignore lint/suspicious/noArrayIndexKey: text parts have no unique id
            <MessageResponse
              key={`${messageId}-${partIdx}`}
              isAnimating={isActiveStream}
              caret={isActiveStream ? 'circle' : undefined}
            >
              {part.text as string}
            </MessageResponse>
          );
        }

        if (part.type.startsWith('tool-') || part.type === 'dynamic-tool') {
          const toolPart = part as unknown as ToolUIPart;
          const toolName = getToolNameFromPart(part);
          const cardData = extractCardFromOutput(part.output);

          // Render send_card results as interactive card
          if (toolName === 'send_card' && cardData) {
            return (
              <CardRenderer
                // biome-ignore lint/suspicious/noArrayIndexKey: tool parts have no unique id
                key={`${messageId}-${partIdx}`}
                card={cardData}
                onAction={onAction}
                readOnly={readOnly}
              />
            );
          }

          // In readOnly mode (staff view), show tool calls collapsed (no hide)

          return (
            // biome-ignore lint/suspicious/noArrayIndexKey: tool parts have no unique id
            <ToolCallPart key={`${messageId}-${partIdx}`} part={toolPart} />
          );
        }

        return null;
      })}
    </>
  );
}
