/**
 * Code-based agent definition.
 * Agents are defined in `modules/ai/agents/` as plain TypeScript files,
 * not in the database. This gives full type safety, version control,
 * and makes agent config greppable by AI coding agents.
 */
export interface AgentConfig {
  /** Unique identifier (slug). Referenced by threads. */
  id: string;
  /** Display name shown in UI. */
  name: string;
  /** System prompt / instructions for the LLM. */
  instructions: string;
  /** Model identifier (e.g. 'gpt-5-mini', 'claude-haiku-4-5'). Falls back to env default. */
  model?: string;
  /** Tool names to enable (e.g. ['search_knowledge_base']). Defaults to ['search_knowledge_base']. */
  tools?: string[];
  /** KB source IDs to scope knowledge base search. Empty = search all. */
  kbSourceIds?: string[];
  /** Channels this agent handles (e.g. ['web', 'whatsapp']). Defaults to ['web']. */
  channels?: string[];
  /** Quick-start prompt suggestions shown in chat UI. */
  suggestions?: string[];
}

/** Define a code-based agent. Returns the config as-is (identity function for type safety). */
export function defineAgent(config: AgentConfig): AgentConfig {
  return config;
}
