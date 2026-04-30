/**
 * Module-scoped handle on the runtime's `AgentContributions<WakeContext>`
 * (the lane-filtered tool catalogue + AGENTS.md contributors + materializer
 * factories collected at boot from every module's `agent` slot).
 *
 * Wake handlers receive contributions as a closure argument at boot —
 * `createApp` collects them once and threads them into every wake-job
 * handler factory. The agents module's AGENTS.md preview HTTP route needs
 * the same data on demand (per-request lane variant), so we capture the
 * collected contributions here at boot and surface them via
 * `getAgentContributions()`.
 *
 * INVARIANT — must be set before the first preview request lands. Bootstrap
 * calls `setAgentContributions(agentContributions)` immediately after
 * `collectAgentContributions(sortedModules)`; if anyone moves the call,
 * the handler will throw a descriptive error rather than silently render
 * a stripped-down preview.
 */

import type { AgentContributions } from '@vobase/core'

import type { WakeContext } from '~/wake/context'

let _contributions: AgentContributions<WakeContext> | null = null

export function setAgentContributions(contributions: AgentContributions<WakeContext>): void {
  _contributions = contributions
}

export function getAgentContributions(): AgentContributions<WakeContext> {
  if (!_contributions) {
    throw new Error('AgentContributions have not been installed; call setAgentContributions() in bootstrap')
  }
  return _contributions
}

export function __resetAgentContributionsForTests(): void {
  _contributions = null
}
