/**
 * Per-turn side-load zone — spec §6.9 + §7.4.
 *
 * The harness concatenates priority-ordered items into each turn's FIRST user message.
 * Critical: mid-wake writes never leak into the current turn's FROZEN prompt — they
 * only surface in the NEXT turn's side-load zone. See spec §2.2.
 */

export type SideLoadKind =
  | 'working_memory'
  | 'pending_approvals'
  | 'delivery_status'
  | 'internal_notes_delta'
  | 'drive_hint'
  | 'custom'

export interface SideLoadItem {
  kind: SideLoadKind
  /** Higher = appears earlier in the zone. */
  priority: number
  render: () => string
}

export interface SideLoadCtx {
  readonly tenantId: string
  readonly conversationId: string
  readonly agentId: string
  readonly contactId: string
  readonly turnIndex: number
}

export type SideLoadContributor = (ctx: SideLoadCtx) => Promise<SideLoadItem[]>

/**
 * Workspace materializer contract — spec §7.5.
 *
 * - `phase='frozen'`  → written once at `agent_start`; baked into system prompt.
 * - `phase='side-load'` → rebuilt each turn; concatenated into turn-1 user message.
 * - `phase='on-read'` → lazy; path is listable but content loads only on `cat`.
 */
export type MaterializerPhase = 'frozen' | 'side-load' | 'on-read'

export interface MaterializerCtx {
  tenantId: string
  agentId: string
  conversationId: string
  contactId: string
  turnIndex: number
  sinceTs?: Date
}

export interface WorkspaceMaterializer {
  /** Absolute workspace path; supports glob for lazy directory mounts. */
  path: string
  phase: MaterializerPhase
  materialize(ctx: MaterializerCtx): Promise<string> | string
}
