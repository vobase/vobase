/**
 * Vobase-specific agent metadata.
 * Fields that have no Mastra equivalent (channels, suggestions, kbSourceIds)
 * are stored here alongside the agent's flat ID.
 *
 * The actual Mastra Agent instance is created in each agent file
 * (e.g. agents/assistant.ts) and registered with the Mastra singleton.
 */

/**
 * Agent operating mode:
 * - full-auto: agent handles the entire conversation autonomously, only consulting humans for edge cases
 * - qualify-then-handoff: agent qualifies the lead/request, then consults a human for final decisions
 */
type AgentMode = 'full-auto' | 'qualify-then-handoff';

export interface AgentMeta {
  /** Flat agent ID matching the Mastra Agent instance (e.g. 'assistant'). */
  id: string;
  /** Display name shown in the UI. */
  name: string;
  /** Model identifier in provider/model format (e.g. 'openai/gpt-5-mini'). Shown in the UI. */
  model: `${string}/${string}`;
  /** KB source IDs to scope knowledge base search. Empty = search all. */
  kbSourceIds?: string[];
  /** Channels this agent handles (e.g. ['web', 'whatsapp']). Defaults to ['web']. */
  channels?: string[];
  /** Quick-start prompt suggestions shown in chat UI. */
  suggestions?: string[];
  /** Operating mode. Defaults to 'full-auto'. */
  mode?: AgentMode;
}
