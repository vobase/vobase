/**
 * Dynamic tool filtering — restricts available tools based on channel type.
 * Used as a `prepareStep` function on the agent to filter tools per-step.
 */
import type {
  ProcessInputStepArgs,
  ProcessInputStepResult,
} from '@mastra/core/processors';

/** Tools that require specific channels to function. Absent = available on all channels. */
const CHANNEL_TOOL_REQUIRE: Record<string, string[]> = {
  send_card: ['whatsapp', 'web'],
};

/** Channel-specific tool deny lists. */
const CHANNEL_TOOL_DENY: Record<string, Set<string>> = {
  // Extendable per channel — e.g. deny 'send_card' on SMS
};

/**
 * Filter tool list based on channel type.
 * Exported for testing.
 */
export function filterToolsByChannel(
  channel: string,
  allToolNames: string[],
): string[] {
  const deny = CHANNEL_TOOL_DENY[channel];

  return allToolNames.filter((name) => {
    if (deny?.has(name)) return false;
    const requiredChannels = CHANNEL_TOOL_REQUIRE[name];
    if (requiredChannels && !requiredChannels.includes(channel)) return false;
    return true;
  });
}

/**
 * Mastra `prepareStep` function for dynamic tool selection.
 * Reads the channel from requestContext and returns `activeTools` per step.
 */
export function dynamicToolStep(
  args: ProcessInputStepArgs,
): ProcessInputStepResult | undefined {
  const channel =
    (args.requestContext?.get?.('channel') as string | undefined) ?? 'web';

  // Get all tool names from the current step's available tools
  const toolNames = Object.keys(args.tools ?? {});
  if (toolNames.length === 0) return undefined;

  const filtered = filterToolsByChannel(channel, toolNames);
  if (filtered.length === toolNames.length) return undefined; // No filtering needed

  return { activeTools: filtered };
}
