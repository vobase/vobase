import { ChevronDownIcon, SearchIcon } from 'lucide-react';
import { useState } from 'react';

import type { ToolPart } from '@/components/ai-elements/tool';
import type { NormalizedPart } from '@/lib/normalize-message';
import { cn } from '@/lib/utils';
import { ToolCallPart } from './tool-call-part';
import {
  getToolEntry,
  getToolNameFromPartType,
  getToolVariant,
} from './tool-registry';

interface ToolGroupProps {
  parts: NormalizedPart[];
  messageId: string;
}

interface ToolGroupSegment {
  type: 'single' | 'collapsed';
  parts: NormalizedPart[];
}

/**
 * Groups consecutive exploration-variant tool parts.
 * 3+ consecutive exploration tools collapse into a summary.
 * Action/default tools always render individually.
 * Hidden tools are filtered out.
 */
function segmentToolParts(parts: NormalizedPart[]): ToolGroupSegment[] {
  const segments: ToolGroupSegment[] = [];
  let explorationBuffer: NormalizedPart[] = [];

  const flushExploration = () => {
    if (explorationBuffer.length === 0) return;
    if (explorationBuffer.length >= 3) {
      segments.push({ type: 'collapsed', parts: [...explorationBuffer] });
    } else {
      for (const p of explorationBuffer) {
        segments.push({ type: 'single', parts: [p] });
      }
    }
    explorationBuffer = [];
  };

  for (const part of parts) {
    const toolName = getToolNameFromPartType(
      part.type,
      part.toolName as string | undefined,
    );
    if (!toolName) {
      flushExploration();
      segments.push({ type: 'single', parts: [part] });
      continue;
    }

    const variant = getToolVariant(toolName);

    if (variant === 'hidden') continue;

    if (variant === 'exploration') {
      explorationBuffer.push(part);
    } else {
      flushExploration();
      segments.push({ type: 'single', parts: [part] });
    }
  }

  flushExploration();
  return segments;
}

function CollapsedToolGroup({
  parts,
  messageId,
}: {
  parts: NormalizedPart[];
  messageId: string;
}) {
  const [expanded, setExpanded] = useState(false);

  const labels = parts.map((p) => {
    const toolName = getToolNameFromPartType(
      p.type,
      p.toolName as string | undefined,
    );
    return toolName ? getToolEntry(toolName).title : p.type;
  });

  const summary = `Searched ${parts.length} sources`;

  return (
    <div className="rounded-md border border-border/50 bg-muted/20">
      <button
        type="button"
        onClick={() => setExpanded(!expanded)}
        className="flex w-full items-center gap-2 px-3 py-1.5 text-xs text-muted-foreground hover:bg-muted/40 transition-colors"
      >
        <SearchIcon className="h-3 w-3" />
        <span className="font-medium">{summary}</span>
        <span className="text-[10px]">({labels.join(', ')})</span>
        <ChevronDownIcon
          className={cn(
            'ml-auto h-3 w-3 transition-transform',
            expanded && 'rotate-180',
          )}
        />
      </button>
      {expanded && (
        <div className="border-t border-border/50 px-1 py-1 space-y-1">
          {parts.map((part, idx) => {
            const toolName = getToolNameFromPartType(
              part.type,
              part.toolName as string | undefined,
            );
            const key = `${messageId}-group-${toolName ?? idx}`;
            return (
              <ToolCallPart key={key} part={part as unknown as ToolPart} />
            );
          })}
        </div>
      )}
    </div>
  );
}

/**
 * Auto-grouping component for tool parts within a message.
 * 3+ consecutive exploration-variant tools collapse into a summary.
 * Action/default tools always show individually.
 * Hidden tools never render.
 */
export function ToolGroup({ parts, messageId }: ToolGroupProps) {
  const segments = segmentToolParts(parts);

  return (
    <>
      {segments.map((segment, segIdx) => {
        const key = `${messageId}-seg-${segIdx}`;
        if (segment.type === 'collapsed') {
          return (
            <CollapsedToolGroup
              key={key}
              parts={segment.parts}
              messageId={messageId}
            />
          );
        }

        const part = segment.parts[0];
        return <ToolCallPart key={key} part={part as unknown as ToolPart} />;
      })}
    </>
  );
}
