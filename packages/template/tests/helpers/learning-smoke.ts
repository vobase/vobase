/**
 * Building-block helpers for interactively smoke-testing the learning loop
 * (triage → candidate → side-load → remember/dismiss) against a live dev
 * server. Layered on top of `changes-smoke.ts`: same `SmokeCtx`, same
 * `sendInbound` / `waitForReply`, with extra inspectors for the
 * `learning_candidates` table, working_memory, and a couple of
 * staff-action helpers (notes, takeover, rejection).
 *
 * Compose by hand from a `bun -e` shell or repl rather than calling a
 * pre-baked recipe — the whole point of slice 3 is to drive the agent
 * through realistic scenarios and watch state transitions.
 */

import {
  type AgentReply,
  close,
  decide,
  devLogin,
  type InsertPendingOpts,
  insertPending,
  listActivity,
  listJournal,
  listTranscript,
  type OpenOpts,
  open,
  type SendInboundOpts,
  type SmokeAuth,
  type SmokeCtx,
  sendInbound,
  waitForReply,
} from './changes-smoke'

// ─── Re-exports — keep one entry point for the helper API ────────────────────

export {
  type AgentReply,
  close,
  decide,
  devLogin,
  type InsertPendingOpts,
  insertPending,
  listActivity,
  listJournal,
  listTranscript,
  type OpenOpts,
  open,
  type SendInboundOpts,
  type SmokeAuth,
  type SmokeCtx,
  sendInbound,
  waitForReply,
}

// ─── Defaults ────────────────────────────────────────────────────────────────

export const MERIGPT_AGENT_ID = 'agt0meri0v1'
export const ALICE_USER_ID = 'usr0alice0'

// ─── Learning candidate inspectors ───────────────────────────────────────────

export interface LearningCandidateRow {
  id: string
  conversationId: string
  signalKind: string
  signalRef: string
  triageConfidence: number
  scopeHint: string | null
  summary: string
  context: string
  status: 'pending' | 'consumed' | 'dismissed' | 'expired'
  consumedByProposalId: string | null
  dismissedReason: string | null
  createdAt: Date
}

/** All learning candidates for an agent, newest-first. */
export async function listCandidates(
  ctx: SmokeCtx,
  opts: {
    agentId?: string
    conversationId?: string
    status?: string
    signalKind?: string
    limit?: number
  } = {},
): Promise<LearningCandidateRow[]> {
  const agentId = opts.agentId ?? MERIGPT_AGENT_ID
  const limit = opts.limit ?? 50
  return ctx.sql<LearningCandidateRow[]>`
    SELECT
      id, conversation_id AS "conversationId", signal_kind AS "signalKind",
      signal_ref AS "signalRef", triage_confidence AS "triageConfidence",
      scope_hint AS "scopeHint", summary, context, status,
      consumed_by_proposal_id AS "consumedByProposalId",
      dismissed_reason AS "dismissedReason", created_at AS "createdAt"
    FROM agents.learning_candidates
    WHERE organization_id = ${ctx.organizationId}
      AND agent_id = ${agentId}
      AND ${opts.conversationId ? ctx.sql`conversation_id = ${opts.conversationId}` : ctx.sql`TRUE`}
      AND ${opts.status ? ctx.sql`status = ${opts.status}` : ctx.sql`TRUE`}
      AND ${opts.signalKind ? ctx.sql`signal_kind = ${opts.signalKind}` : ctx.sql`TRUE`}
    ORDER BY created_at DESC
    LIMIT ${limit}
  `
}

/**
 * Wait for the triage job to land a candidate. Backs off 1s → 3s so a long
 * timeout doesn't hammer the DB.
 */
export async function waitForCandidate(
  ctx: SmokeCtx,
  conversationId: string,
  opts: { signalKind?: string; afterCount?: number; timeoutS?: number } = {},
): Promise<LearningCandidateRow> {
  const timeoutS = opts.timeoutS ?? 30
  const afterCount = opts.afterCount ?? 0
  const deadline = Date.now() + timeoutS * 1000
  let waitMs = 1000
  while (Date.now() < deadline) {
    await new Promise((r) => setTimeout(r, waitMs))
    waitMs = Math.min(3000, Math.floor(waitMs * 1.5))
    const rows = await listCandidates(ctx, { conversationId, signalKind: opts.signalKind })
    if (rows.length > afterCount && rows[0]) return rows[0]
  }
  throw new Error(
    `waitForCandidate timed out after ${timeoutS}s (need >${afterCount} candidates of kind=${opts.signalKind ?? '*'})`,
  )
}

/** Count candidates by status — quick health-check after a scenario. */
export async function candidateCounts(
  ctx: SmokeCtx,
  agentId: string = MERIGPT_AGENT_ID,
): Promise<Record<string, number>> {
  const rows = await ctx.sql<{ status: string; n: number }[]>`
    SELECT status, count(*)::int AS n
    FROM agents.learning_candidates
    WHERE organization_id = ${ctx.organizationId} AND agent_id = ${agentId}
    GROUP BY status
  `
  const out: Record<string, number> = {}
  for (const row of rows) out[row.status] = row.n
  return out
}

// ─── Memory inspectors ───────────────────────────────────────────────────────

/** Read the current `working_memory` blob from the agent definition. */
export async function readAgentMemory(ctx: SmokeCtx, agentId: string = MERIGPT_AGENT_ID): Promise<string> {
  const rows = await ctx.sql<{ workingMemory: string }[]>`
    SELECT working_memory AS "workingMemory" FROM agents.agent_definitions WHERE id = ${agentId}
  `
  return rows[0]?.workingMemory ?? ''
}

/** Read the current `memory` blob on a contact row. */
export async function readContactMemory(ctx: SmokeCtx, contactId: string): Promise<string> {
  const rows = await ctx.sql<{ memory: string }[]>`
    SELECT memory FROM contacts.contacts WHERE id = ${contactId}
  `
  return rows[0]?.memory ?? ''
}

/** Read the per-(agent, staff) staff_memory blob. */
export async function readStaffMemory(
  ctx: SmokeCtx,
  staffId: string,
  agentId: string = MERIGPT_AGENT_ID,
): Promise<string> {
  const rows = await ctx.sql<{ memory: string }[]>`
    SELECT memory FROM agents.agent_staff_memory
    WHERE agent_id = ${agentId} AND staff_id = ${staffId}
  `
  return rows[0]?.memory ?? ''
}

// ─── Proposals + sensitivity inspector ───────────────────────────────────────

export interface ProposalRow {
  id: string
  resourceModule: string
  resourceType: string
  resourceId: string
  status: string
  confidence: number | null
  rationale: string | null
  payload: unknown
  createdAt: Date
}

/** All proposals for a conversation (ordered by `created_at`). */
export async function listProposals(ctx: SmokeCtx, conversationId: string): Promise<ProposalRow[]> {
  return ctx.sql<ProposalRow[]>`
    SELECT id, resource_module AS "resourceModule", resource_type AS "resourceType",
           resource_id AS "resourceId", status, confidence, rationale, payload, created_at AS "createdAt"
    FROM changes.change_proposals
    WHERE conversation_id = ${conversationId}
    ORDER BY created_at ASC
  `
}

/** All proposals scoped to a resource, regardless of conversation. */
export async function listProposalsForResource(
  ctx: SmokeCtx,
  resourceModule: string,
  resourceType: string,
  resourceId: string,
): Promise<ProposalRow[]> {
  return ctx.sql<ProposalRow[]>`
    SELECT id, resource_module AS "resourceModule", resource_type AS "resourceType",
           resource_id AS "resourceId", status, confidence, rationale, payload, created_at AS "createdAt"
    FROM changes.change_proposals
    WHERE organization_id = ${ctx.organizationId}
      AND resource_module = ${resourceModule}
      AND resource_type = ${resourceType}
      AND resource_id = ${resourceId}
    ORDER BY created_at ASC
  `
}

// ─── Staff actions ───────────────────────────────────────────────────────────

/**
 * Post a staff direct reply to the customer (the takeover path). Goes
 * through `/reply`, which writes a `staff` role message and emits a
 * `staff_takeover` learning signal when the conversation is
 * agent-assigned.
 */
export async function staffReply(ctx: SmokeCtx, conversationId: string, body: string): Promise<{ messageId: string }> {
  const res = await ctx.authedFetch(`/api/messaging/conversations/${conversationId}/reply`, {
    method: 'POST',
    body: JSON.stringify({ body }),
  })
  const txt = await res.text()
  if (!res.ok) throw new Error(`staffReply ${res.status}: ${txt}`)
  return JSON.parse(txt) as { messageId: string }
}

/**
 * Post an internal coaching note. Without `mentions`, it emits the
 * `coaching_note` learning signal; with mentions, it triggers
 * staff-note fan-out (handled by main wake) and triage is skipped.
 */
export async function staffNote(
  ctx: SmokeCtx,
  conversationId: string,
  body: string,
  opts: { mentions?: string[]; authorType?: 'staff' | 'agent'; authorId?: string } = {},
): Promise<{ noteId: string }> {
  const authorType = opts.authorType ?? 'staff'
  const authorId = opts.authorId ?? ctx.auth.userId
  const res = await ctx.authedFetch(`/api/messaging/conversations/${conversationId}/notes`, {
    method: 'POST',
    body: JSON.stringify({ body, mentions: opts.mentions ?? [], authorType, authorId }),
  })
  const txt = await res.text()
  if (!res.ok) throw new Error(`staffNote ${res.status}: ${txt}`)
  return JSON.parse(txt) as { noteId: string }
}

// ─── Channel echo simulation ─────────────────────────────────────────────────

/**
 * Posts an inbound web message tagged with `metadata.echo = true` so the
 * adapter routes it through the staff-mirror branch (no agent wake; emits a
 * `coexistence_echo` triage signal when the conversation is agent-assigned).
 */
export async function injectEcho(
  ctx: SmokeCtx,
  contactExternalId: string,
  body: string,
): Promise<{ conversationId: string; messageId: string }> {
  const result = await sendInbound(ctx, body, {
    from: contactExternalId,
    profileName: 'Echo Customer',
    metadata: { echo: true },
  })
  return { conversationId: result.conversationId, messageId: result.messageId }
}

// ─── Pretty printers ─────────────────────────────────────────────────────────

const STATUS_PAD: Record<string, string> = {
  pending: 'pending  ',
  consumed: 'consumed ',
  dismissed: 'dismissed',
  expired: 'expired  ',
}

export function printCandidates(rows: LearningCandidateRow[]): void {
  if (rows.length === 0) {
    console.log('  (no candidates)')
    return
  }
  for (const r of rows) {
    const conf = (r.triageConfidence * 100).toFixed(0).padStart(3, ' ')
    const status = STATUS_PAD[r.status] ?? r.status
    console.log(
      `  [${status}] ${r.id} ${conf}% (${r.signalKind})${r.scopeHint ? ` → ${r.scopeHint}` : ''} — ${r.summary.slice(0, 70)}`,
    )
  }
}

export function printProposals(rows: ProposalRow[]): void {
  if (rows.length === 0) {
    console.log('  (no proposals)')
    return
  }
  for (const r of rows) {
    const conf = r.confidence != null ? `${(r.confidence * 100).toFixed(0)}%` : ' n/a'
    console.log(`  [${r.status}] ${r.id} ${r.resourceModule}.${r.resourceType}#${r.resourceId} conf=${conf}`)
    if (r.rationale) console.log(`     ${r.rationale.slice(0, 100)}`)
  }
}
