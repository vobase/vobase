/**
 * AgentsPort — what other modules call INTO `agents`.
 */

import type { AgentDefinition } from './domain-types'
import type { AgentEvent } from './event'
import type { Tx } from './inbox-port'

export interface AgentsPort {
  /** Fetch the definition used to construct `SOUL.md` + tool allowlist. */
  getAgentDefinition(id: string): Promise<AgentDefinition>

  /**
   * The SOLE write path for `agents.conversation_events` (one-write-path discipline).
   * Every harness event, every observer-emitted event, flows through here.
   * Called inside the caller's transaction so domain mutation + journal land atomically.
   */
  appendEvent(event: AgentEvent, tx?: Tx): Promise<void>

  /**
   * Returns whether this tenant's daily LLM spend has reached the agent's hard ceiling.
   * Called by the inbound-message NACK path before starting a wake.
   */
  checkDailyCeiling(
    tenantId: string,
    agentId: string,
  ): Promise<{ exceeded: boolean; spentUsd: number; ceilingUsd: number }>
}
