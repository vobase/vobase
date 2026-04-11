import type { Agent } from '@mastra/core/agent';

import type { AgentMeta } from '../lib/agents/define';
import { bookingAgent, bookingMeta } from './booking';

type RegisteredAgent = { agent: Agent; meta: AgentMeta };

/** All registered agents. Add new agents here. */
const agents: RegisteredAgent[] = [{ agent: bookingAgent, meta: bookingMeta }];

const agentMap = new Map(agents.map((a) => [a.meta.id, a]));

/** Get a registered agent by ID. Returns undefined if not found. */
export function getAgent(id: string): RegisteredAgent | undefined {
  return agentMap.get(id);
}

/** List all registered agents. */
export function listAgents(): RegisteredAgent[] {
  return agents;
}

/** Get agents as Record<string, Agent> for the Mastra singleton. */
export function getMastraAgents(): Record<string, Agent> {
  return Object.fromEntries(agents.map((a) => [a.meta.id, a.agent]));
}
