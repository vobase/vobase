/**
 * agents module state transitions.
 * Agents are stateless across wakes — no status enum on agent_definitions.
 * Stub TransitionTable to satisfy module-shape contract.
 */
import type { TransitionTable } from '@server/runtime/apply-transition'

export type AgentStatus = never

export const agentTransitions: TransitionTable<string> = {
  transitions: [],
  terminal: [],
}
