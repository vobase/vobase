/**
 * AgentsPort — what other modules call INTO `agents`. Derived from spec §5.3
 * cross-module reads + the minimum surface needed by Phase 1's green-thread wake.
 *
 * Phase 1 REAL methods (per plan §R4):
 *   - `getAgentDefinition(id)`
 *   - `appendEvent(event, tx?)` — sole write path for `agents.conversation_events` (§2.3)
 * All other methods throw `not-implemented-in-phase-1` until Phase 2.
 */

import type { AgentDefinition } from './domain-types'
import type { AgentEvent } from './event'
import type { Tx } from './inbox-port'

export interface AgentsPort {
  /** Fetch the definition used to construct `SOUL.md` + tool allowlist. */
  getAgentDefinition(id: string): Promise<AgentDefinition>

  /**
   * The SOLE write path for `agents.conversation_events` (spec §2.3 + plan B5).
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
