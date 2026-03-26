import type { DynamicToolUIPart } from 'ai';

import {
  Tool,
  ToolContent,
  ToolHeader,
  ToolInput,
  ToolOutput,
  type ToolPart,
} from '@/components/ai-elements/tool';

export function ToolCallPart({ part }: { part: ToolPart }) {
  if (part.type === 'dynamic-tool') {
    const dynPart = part as DynamicToolUIPart;
    return (
      <Tool>
        <ToolHeader
          type={dynPart.type}
          state={dynPart.state}
          toolName={dynPart.toolName}
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
      <ToolHeader type={part.type} state={part.state} />
      <ToolContent>
        {part.input !== undefined && <ToolInput input={part.input} />}
        <ToolOutput output={part.output} errorText={part.errorText} />
      </ToolContent>
    </Tool>
  );
}
