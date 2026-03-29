import type { CardElement } from 'chat';
import { useMemo } from 'react';

import { CardRenderer } from '@/components/ai-elements/card-renderer';
import { MessageResponse } from '@/components/ai-elements/message';
import {
  Reasoning,
  ReasoningContent,
  ReasoningTrigger,
} from '@/components/ai-elements/reasoning';
import {
  Source,
  Sources,
  SourcesContent,
  SourcesTrigger,
} from '@/components/ai-elements/sources';
import type { NormalizedPart } from '@/lib/normalize-message';
import { ToolGroup } from './tool-group';
import { getToolNameFromPartType } from './tool-registry';

interface MessagePartsRendererProps {
  parts: Array<{ type: string; text?: string; [key: string]: unknown }>;
  messageId: string;
  onAction?: (actionId: string, value?: string) => void;
  readOnly?: boolean;
  /** Pass true for the currently streaming assistant message */
  isStreaming?: boolean;
}

/** Extract card data from tool output, handling various shapes */
function extractCardFromOutput(output: unknown): CardElement | null {
  if (!output || typeof output !== 'object') return null;
  const obj = output as Record<string, unknown>;
  if ('card' in obj && obj.card && typeof obj.card === 'object') {
    const card = obj.card as Record<string, unknown>;
    if (card.type === 'card') return card as unknown as CardElement;
  }
  if (obj.type === 'card' && 'children' in obj) {
    return obj as unknown as CardElement;
  }
  return null;
}

type SegmentType = 'text' | 'tool-group' | 'card' | 'reasoning' | 'sources';

interface Segment {
  type: SegmentType;
  parts: Array<{ type: string; text?: string; [key: string]: unknown }>;
  startIdx: number;
}

function segmentParts(
  parts: Array<{ type: string; text?: string; [key: string]: unknown }>,
): Segment[] {
  const segments: Segment[] = [];
  let toolBuffer: typeof parts = [];
  let toolStartIdx = 0;
  let sourceBuffer: typeof parts = [];
  let sourceStartIdx = 0;

  const flushTools = () => {
    if (toolBuffer.length === 0) return;
    segments.push({
      type: 'tool-group',
      parts: [...toolBuffer],
      startIdx: toolStartIdx,
    });
    toolBuffer = [];
  };

  const flushSources = () => {
    if (sourceBuffer.length === 0) return;
    segments.push({
      type: 'sources',
      parts: [...sourceBuffer],
      startIdx: sourceStartIdx,
    });
    sourceBuffer = [];
  };

  for (let i = 0; i < parts.length; i++) {
    const part = parts[i];
    const isTool =
      part.type.startsWith('tool-') || part.type === 'dynamic-tool';

    if (part.type === 'reasoning') {
      flushTools();
      flushSources();
      segments.push({ type: 'reasoning', parts: [part], startIdx: i });
      continue;
    }

    if (part.type === 'source') {
      flushTools();
      if (sourceBuffer.length === 0) sourceStartIdx = i;
      sourceBuffer.push(part);
      continue;
    }

    flushSources();

    if (isTool) {
      const toolName = getToolNameFromPartType(
        part.type,
        part.toolName as string | undefined,
      );
      const cardData = extractCardFromOutput(part.output);

      if (toolName === 'send_card' && cardData) {
        flushTools();
        segments.push({ type: 'card', parts: [part], startIdx: i });
        continue;
      }

      if (toolBuffer.length === 0) toolStartIdx = i;
      toolBuffer.push(part);
    } else {
      flushTools();
      segments.push({ type: 'text', parts: [part], startIdx: i });
    }
  }
  flushTools();
  flushSources();
  return segments;
}

export function MessagePartsRenderer({
  parts,
  messageId,
  onAction,
  readOnly,
  isStreaming,
}: MessagePartsRendererProps) {
  const lastTextIdx = isStreaming
    ? parts.findLastIndex((p) => p.type === 'text')
    : -1;

  const segments = useMemo(() => segmentParts(parts), [parts]);

  return (
    <>
      {segments.map((segment) => {
        if (segment.type === 'text') {
          const part = segment.parts[0];
          const isActiveStream = segment.startIdx === lastTextIdx;
          return (
            <MessageResponse
              key={`${messageId}-text-${segment.startIdx}`}
              isAnimating={isActiveStream}
              caret={isActiveStream ? 'circle' : undefined}
            >
              {part.text as string}
            </MessageResponse>
          );
        }

        if (segment.type === 'reasoning') {
          const part = segment.parts[0];
          const reasoningText = (part.reasoning as string) ?? '';
          if (!reasoningText) return null;
          return (
            <Reasoning
              key={`${messageId}-reasoning-${segment.startIdx}`}
              isStreaming={!!isStreaming}
            >
              <ReasoningTrigger />
              <ReasoningContent>{reasoningText}</ReasoningContent>
            </Reasoning>
          );
        }

        if (segment.type === 'sources') {
          const sources = segment.parts as Array<{
            type: string;
            source?: {
              title?: string;
              url?: string;
              description?: string;
              [key: string]: unknown;
            };
            [key: string]: unknown;
          }>;
          return (
            <Sources key={`${messageId}-sources-${segment.startIdx}`}>
              <SourcesTrigger count={sources.length} />
              <SourcesContent>
                {sources.map((s, srcIdx) => {
                  const src = s.source ?? s;
                  const url = (src.url as string) ?? '#';
                  const title = (src.title as string) ?? url;
                  return (
                    <Source
                      // biome-ignore lint/suspicious/noArrayIndexKey: sources lack stable IDs, idx ensures uniqueness for duplicate URLs
                      key={`${messageId}-source-${srcIdx}`}
                      title={title}
                      href={url}
                    />
                  );
                })}
              </SourcesContent>
            </Sources>
          );
        }

        if (segment.type === 'card') {
          const part = segment.parts[0];
          const cardData = extractCardFromOutput(part.output);
          if (!cardData) return null;
          return (
            <CardRenderer
              key={`${messageId}-card-${segment.startIdx}`}
              card={cardData}
              onAction={onAction}
              readOnly={readOnly}
            />
          );
        }

        // tool-group: delegate to ToolGroup for auto-collapsing
        return (
          <ToolGroup
            key={`${messageId}-tools-${segment.startIdx}`}
            parts={segment.parts as NormalizedPart[]}
            messageId={messageId}
          />
        );
      })}
    </>
  );
}
