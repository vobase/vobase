/**
 * Sole write path for `agents.learning_candidates`.
 *
 * Provides CRUD + sweep operations consumed by:
 * - triage job (`wake/learning/triage.ts`) — inserts candidates after cheap-model evaluation.
 * - side-load contributor (`wake/learning/side-load.ts`) — reads pending candidates per wake.
 * - expiry cron (`wake/learning/expiry-cron.ts`) — sweeps stale pending rows to `expired`.
 * - agent tools `remember` / `dismiss_candidate` — mark consumed / dismissed.
 */

import type { LearningCandidate, LearningCandidateStatus, LearningSignalKind } from '@modules/agents/schema'
import { learningCandidates } from '@modules/agents/schema'
import { and, count, desc, eq, lt, ne, sql } from 'drizzle-orm'

import type { RealtimeService, ScopedDb } from '~/runtime'
import { learningThresholds } from '~/wake/learning/thresholds'

// ─── Public input / output types ─────────────────────────────────────────────

export interface InsertLearningCandidateInput {
  organizationId: string
  agentId: string
  conversationId: string
  signalKind: LearningSignalKind
  signalRef: string
  triageConfidence: number
  scopeHint?: string | null
  summary: string
  context: string
}

// ─── Service interface ────────────────────────────────────────────────────────

export interface LearningCandidatesService {
  /** Insert a new pending candidate and emit a realtime notify. */
  insertCandidate(input: InsertLearningCandidateInput): Promise<LearningCandidate>

  /** Pending candidates for the active conversation, newest-first. */
  listPendingForConversation(
    orgId: string,
    agentId: string,
    conversationId: string,
    limit?: number,
  ): Promise<LearningCandidate[]>

  /** Count of pending candidates belonging to OTHER conversations (cross-conversation signal). */
  countPendingOtherConversations(orgId: string, agentId: string, currentConversationId: string): Promise<number>

  /** Mark a candidate as consumed by a change proposal. Idempotent (no-op if already consumed). */
  markConsumed(candidateId: string, proposalId: string): Promise<void>

  /** Mark a candidate as dismissed with an audit reason. No-op if already not pending. */
  markDismissed(candidateId: string, reason: string): Promise<void>

  /**
   * Flip all `pending` candidates older than `olderThanDays` to `expired`.
   * Returns the number of rows updated.
   */
  sweepExpired(olderThanDays: number): Promise<number>
}

// ─── Factory ──────────────────────────────────────────────────────────────────

export function createLearningCandidatesService(deps: {
  db: ScopedDb
  realtime: RealtimeService
}): LearningCandidatesService {
  const { db, realtime } = deps

  async function insertCandidate(input: InsertLearningCandidateInput): Promise<LearningCandidate> {
    if (!input.organizationId) throw new Error('learning-candidates: organizationId is required')
    if (!input.agentId) throw new Error('learning-candidates: agentId is required')
    if (!input.conversationId) throw new Error('learning-candidates: conversationId is required')
    if (!input.signalRef) throw new Error('learning-candidates: signalRef is required')
    if (!input.summary) throw new Error('learning-candidates: summary is required')
    if (!input.context) throw new Error('learning-candidates: context is required')
    if (input.triageConfidence < 0 || input.triageConfidence > 1) {
      throw new Error('learning-candidates: triageConfidence must be between 0 and 1')
    }

    const rows = await db
      .insert(learningCandidates)
      .values({
        organizationId: input.organizationId,
        agentId: input.agentId,
        conversationId: input.conversationId,
        signalKind: input.signalKind,
        signalRef: input.signalRef,
        triageConfidence: input.triageConfidence,
        scopeHint: input.scopeHint ?? null,
        summary: input.summary,
        context: input.context,
        status: 'pending' as LearningCandidateStatus,
      })
      .returning()

    const row = rows[0]
    if (!row) throw new Error('learning-candidates: insert returned no row')

    try {
      realtime.notify({
        table: 'learning_candidates',
        action: 'inserted',
        resourceModule: 'agents',
        resourceId: row.id,
      })
    } catch {
      // notify is best-effort
    }

    return row
  }

  async function listPendingForConversation(
    orgId: string,
    agentId: string,
    conversationId: string,
    limit?: number,
  ): Promise<LearningCandidate[]> {
    const cap = limit ?? learningThresholds.candidateSideLoadCap
    return db
      .select()
      .from(learningCandidates)
      .where(
        and(
          eq(learningCandidates.status, 'pending'),
          eq(learningCandidates.organizationId, orgId),
          eq(learningCandidates.agentId, agentId),
          eq(learningCandidates.conversationId, conversationId),
        ),
      )
      .orderBy(desc(learningCandidates.createdAt))
      .limit(cap)
  }

  async function countPendingOtherConversations(
    orgId: string,
    agentId: string,
    currentConversationId: string,
  ): Promise<number> {
    const rows = await db
      .select({ n: count() })
      .from(learningCandidates)
      .where(
        and(
          eq(learningCandidates.status, 'pending'),
          eq(learningCandidates.organizationId, orgId),
          eq(learningCandidates.agentId, agentId),
          ne(learningCandidates.conversationId, currentConversationId),
        ),
      )
    return rows[0]?.n ?? 0
  }

  async function markConsumed(candidateId: string, proposalId: string): Promise<void> {
    await db
      .update(learningCandidates)
      .set({ status: 'consumed', consumedByProposalId: proposalId })
      .where(and(eq(learningCandidates.id, candidateId), eq(learningCandidates.status, 'pending')))
  }

  async function markDismissed(candidateId: string, reason: string): Promise<void> {
    await db
      .update(learningCandidates)
      .set({ status: 'dismissed', dismissedReason: reason })
      .where(and(eq(learningCandidates.id, candidateId), eq(learningCandidates.status, 'pending')))
  }

  async function sweepExpired(olderThanDays: number): Promise<number> {
    const cutoff = sql`now() - (${String(olderThanDays)} || ' days')::interval`
    const rows = await db
      .update(learningCandidates)
      .set({ status: 'expired' })
      .where(and(eq(learningCandidates.status, 'pending'), lt(learningCandidates.createdAt, cutoff)))
      .returning({ id: learningCandidates.id })
    return rows.length
  }

  return {
    insertCandidate,
    listPendingForConversation,
    countPendingOtherConversations,
    markConsumed,
    markDismissed,
    sweepExpired,
  }
}

// ─── Singleton install / reset ────────────────────────────────────────────────

let _current: LearningCandidatesService | null = null

export function installLearningCandidatesService(svc: LearningCandidatesService): void {
  _current = svc
}

export function __resetLearningCandidatesServiceForTests(): void {
  _current = null
}

function current(): LearningCandidatesService {
  if (!_current) {
    throw new Error(
      'agents/learning-candidates: service not installed — call installLearningCandidatesService() in module init',
    )
  }
  return _current
}

// ─── Top-level facade (singleton pass-through) ────────────────────────────────

export function insertCandidate(input: InsertLearningCandidateInput): Promise<LearningCandidate> {
  return current().insertCandidate(input)
}

export function listPendingForConversation(
  orgId: string,
  agentId: string,
  conversationId: string,
  limit?: number,
): Promise<LearningCandidate[]> {
  return current().listPendingForConversation(orgId, agentId, conversationId, limit)
}

export function countPendingOtherConversations(
  orgId: string,
  agentId: string,
  currentConversationId: string,
): Promise<number> {
  return current().countPendingOtherConversations(orgId, agentId, currentConversationId)
}

export function markConsumed(candidateId: string, proposalId: string): Promise<void> {
  return current().markConsumed(candidateId, proposalId)
}

export function markDismissed(candidateId: string, reason: string): Promise<void> {
  return current().markDismissed(candidateId, reason)
}

export function sweepExpired(olderThanDays: number): Promise<number> {
  return current().sweepExpired(olderThanDays)
}
