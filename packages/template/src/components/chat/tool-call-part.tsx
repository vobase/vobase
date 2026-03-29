import type { DynamicToolUIPart } from 'ai';

import {
  Tool,
  ToolContent,
  ToolHeader,
  ToolInput,
  ToolOutput,
  type ToolPart,
} from '@/components/ai-elements/tool';
import { getToolEntry, getToolNameFromPartType } from './tool-registry';

export function ToolCallPart({ part }: { part: ToolPart }) {
  const toolName = getToolNameFromPartType(
    part.type,
    part.type === 'dynamic-tool'
      ? (part as DynamicToolUIPart).toolName
      : undefined,
  );
  const entry = toolName ? getToolEntry(toolName) : null;

  if (part.type === 'dynamic-tool') {
    const dynPart = part as DynamicToolUIPart;
    return (
      <Tool>
        <ToolHeader
          type={dynPart.type}
          state={dynPart.state}
          toolName={entry?.title ?? dynPart.toolName}
        />
        <ToolContent>
          {dynPart.input !== undefined && <ToolInput input={dynPart.input} />}
          <ToolOutput output={dynPart.output} errorText={dynPart.errorText} />
        </ToolContent>
      </Tool>
    );
  }

  return (
    <Tool>
      <ToolHeader type={part.type} state={part.state} title={entry?.title} />
      <ToolContent>
        {part.input !== undefined && <ToolInput input={part.input} />}
        <ToolOutput output={part.output} errorText={part.errorText} />
      </ToolContent>
    </Tool>
  );
}
