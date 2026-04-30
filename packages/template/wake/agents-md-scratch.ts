/**
 * Typed channel for wake-time facts to flow into AGENTS.md contributors.
 *
 * `IndexContributorContext.scratch` is an untyped record by core design — that
 * keeps the index-file builder generic and reusable for non-wake builds.
 * Template modules that want lane-aware prose go through this accessor so
 * the bag stays type-safe at every read/write site.
 *
 * Writer: `agentsMaterializerFactory` in `modules/agents/agent.ts`.
 * Readers: per-module AGENTS.md contributors (e.g. messaging's
 *   supervisor-coaching block, standalone customer-tools-stripped block).
 */

import type { IndexContributorContext } from '@vobase/core'

import type { WakeTrigger } from './events'

export type LaneName = 'conversation' | 'standalone'

export type SupervisorKind = 'coaching' | 'ask_staff_answer'

export interface WakeAgentsMdScratch {
  lane: LaneName
  triggerKind: WakeTrigger['trigger']
  /** Set only when `triggerKind === 'supervisor'` (conversation lane). */
  supervisorKind?: SupervisorKind
}

/**
 * Sentinel key used by both writer and readers. Single string constant so a
 * typo in either side surfaces as a missing-import compile error.
 */
export const WAKE_AGENTS_MD_SCRATCH_KEY = 'wake.agentsMd' as const

/**
 * Read the typed wake-scratch bag from `IndexContributorContext`. Returns
 * `null` when the bag isn't present (e.g. AGENTS.md generated outside a
 * wake — UI preview without a synthetic wake context, sample render in the
 * agents-config form, etc.); contributors should treat that as "fall back to
 * lane-agnostic text" rather than throw.
 */
export function getWakeAgentsMdScratch(ctx: IndexContributorContext): WakeAgentsMdScratch | null {
  const bag = ctx.scratch?.[WAKE_AGENTS_MD_SCRATCH_KEY]
  if (!bag || typeof bag !== 'object') return null
  return bag as WakeAgentsMdScratch
}

/**
 * Build the scratch envelope for `generateAgentsMd({ scratch })`. Returned
 * as `Record<string, unknown>` so it nests cleanly under the
 * `WAKE_AGENTS_MD_SCRATCH_KEY` namespace alongside any future scratch keys.
 */
export function buildWakeAgentsMdScratch(value: WakeAgentsMdScratch): Record<string, unknown> {
  return { [WAKE_AGENTS_MD_SCRATCH_KEY]: value }
}
