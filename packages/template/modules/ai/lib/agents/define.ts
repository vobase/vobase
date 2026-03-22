/**
 * Vobase-specific agent metadata.
 * Fields that have no Mastra equivalent (channels, suggestions, kbSourceIds)
 * are stored here alongside the agent's flat ID.
 *
 * The actual Mastra Agent instance is created in each agent file
 * (e.g. agents/assistant.ts) and registered with the Mastra singleton.
 */

export interface AgentMeta {
  /** Flat agent ID matching the Mastra Agent instance (e.g. 'assistant'). */
  id: string;
  /** Display name shown in the UI. */
  name: string;
  /** KB source IDs to scope knowledge base search. Empty = search all. */
  kbSourceIds?: string[];
  /** Channels this agent handles (e.g. ['web', 'whatsapp']). Defaults to ['web']. */
  channels?: string[];
  /** Quick-start prompt suggestions shown in chat UI. */
  suggestions?: string[];
}
