/**
 * Template specialization of `WorkspaceMaterializerFactory<TCtx>` carrying
 * the wake-time identity, service handles, and lane-filtered contribution
 * slices that per-module materializer factories consume.
 */

import type { AuthLookup } from '@auth/lookup'
import type { AgentDefinition } from '@modules/agents/schema'
import type { FilesService } from '@modules/drive/service/files'
import type { AgentTool, IndexContributor, WorkspaceMaterializerFactory } from '@vobase/core'

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
}

/** Template-specialized materializer factory alias. */
export type WakeMaterializerFactory = WorkspaceMaterializerFactory<WakeContext>
