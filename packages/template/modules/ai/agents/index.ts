import type { AgentConfig } from '../lib/agents/define';
import { assistantAgent } from './assistant';
import { quickHelperAgent } from './quick-helper';

export type { AgentConfig } from '../lib/agents/define';

/** All registered agents. Add new agents here. */
const agents: AgentConfig[] = [assistantAgent, quickHelperAgent];

const agentMap = new Map(agents.map((a) => [a.id, a]));

/** Get an agent by ID. Returns undefined if not found. */
export function getAgent(id: string): AgentConfig | undefined {
  return agentMap.get(id);
}

/** List all registered agents. */
export function listAgents(): AgentConfig[] {
  return agents;
}

/** Find the first agent configured for a given channel. */
export function getAgentForChannel(channel: string): AgentConfig | undefined {
  return agents.find((a) => (a.channels ?? ['web']).includes(channel));
}

/** Get the default agent (first registered). */
export function getDefaultAgent(): AgentConfig | undefined {
  return agents[0];
}
