/**
 * Template specialization of `WorkspaceMaterializerFactory<TCtx>` carrying
 * the wake-time identity, service handles, and lane-filtered contribution
 * slices that per-module materializer factories consume.
 */

import type { AuthLookup } from '@auth/lookup'
import type { AgentDefinition } from '@modules/agents/schema'
import type { FilesService } from '@modules/drive/service/files'
import type { AgentTool, IndexContributor, WakeAudienceTier, WorkspaceMaterializerFactory } from '@vobase/core'

import type { LaneName, SupervisorKind } from './agents-md-scratch'
import type { WakeTrigger } from './events'

export interface WakeContext {
  organizationId: string
  agentId: string
  /** Undefined on standalone-lane wakes (operator-thread, heartbeat). */
  contactId?: string
  /** Undefined on standalone-lane wakes. */
  channelInstanceId?: string
  conversationId: string
  drive: FilesService
  staffIds: readonly string[]
  authLookup: AuthLookup
  agentDefinition: AgentDefinition
  /** Lane-filtered tool catalogue available to this wake. */
  tools: readonly AgentTool[]
  /** Cross-module AGENTS.md fragments collected for this wake. */
  agentsMdContributors: readonly IndexContributor[]
  /** Which wake builder produced this context. */
  lane: LaneName
  /** Trigger that fired this wake. */
  triggerKind: WakeTrigger['trigger']
  /**
   * Set only when `triggerKind === 'supervisor'`. Drives module-side
   * lane-aware AGENTS.md contributors (coaching vs ask-staff-answer prose).
   */
  supervisorKind?: SupervisorKind
  /**
   * Trust tier this wake operates at. Derived from `(lane, triggerKind)`:
   *   conversation + inbound_message    → 'contact'
   *   conversation + supervisor/approval/scheduled/manual → 'staff'
   *   standalone   + operator_thread/heartbeat            → 'staff'
   * Drives the AGENTS.md `## Commands` filter and the in-bash `--help`
   * filter; verbs are visible iff `verb.audience ≤ this tier`.
   */
  audienceTier: WakeAudienceTier
}

/** Template-specialized materializer factory alias. */
export type WakeMaterializerFactory = WorkspaceMaterializerFactory<WakeContext>
