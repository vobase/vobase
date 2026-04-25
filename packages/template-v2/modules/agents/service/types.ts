/**
 * Agents service types — the AgentsPort interface consumed by
 * the harness, dev layer, and other modules.
 */

import type { AgentEvent } from '@modules/agents/events'

import type { Tx } from '~/runtime'
import type { AgentDefinition } from '../schema'

export interface AgentsPort {
  /** Fetch the definition used to construct the AGENTS.md composite + tool allowlist. */
  getAgentDefinition(id: string): Promise<AgentDefinition>

  /**
   * The SOLE write path for `agents.conversation_events` (one-write-path discipline).
   * Every harness event, every observer-emitted event, flows through here.
   * Called inside the caller's transaction so domain mutation + journal land atomically.
   */
  appendEvent(event: AgentEvent, tx?: Tx): Promise<void>

  /**
   * Returns whether this organization's daily LLM spend has reached the agent's hard ceiling.
   * Called by the inbound-message NACK path before starting a wake.
   */
  checkDailyCeiling(
    organizationId: string,
    agentId: string,
  ): Promise<{ exceeded: boolean; spentUsd: number; ceilingUsd: number }>
}
