const AGENT_PREFIX = 'agent:';

export function isAgentAssignee(assignee: string | null | undefined): boolean {
  return !!assignee?.startsWith(AGENT_PREFIX);
}

export function agentAssignee(agentId: string): string {
  return `${AGENT_PREFIX}${agentId}`;
}
