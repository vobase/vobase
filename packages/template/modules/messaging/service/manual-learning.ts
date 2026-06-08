/**
 * Producer for the manual "learn from this thread" pass.
 *
 * Staff trigger a one-off learning-triage sweep over a single conversation —
 * primarily WhatsApp-coexistence threads backfilled from history sync, which
 * land `unassigned` and so have no agent to attribute learning to. This service:
 *
 *   1. Resolves the agent: explicit param → conversation assignee (`agent:`)
 *      → channel-instance default (`config.defaultAssignee`).
 *   2. Loads + renders the conversation (most-recent slice, cost-capped) and
 *      chunks it into windows.
 *   3. Enqueues one `learning:triage` job per window with the rendered window
 *      text in `signal.body` and a distinct `windowRef`.
 *
 * The triage classifier + candidate write happen later in the job handler
 * (`wake/learning/triage-job.ts`). Manual jobs bypass the kill-switch (this is
 * always enqueued, never gated by `isAutoTriageEnabled`) and the per-(conv,
 * kind) debounce (so chunked windows don't collapse into one candidate).
 */

import { channelInstances } from '@modules/channels/schema'
import { conversations, messages } from '@modules/messaging/schema'
import { desc, eq } from 'drizzle-orm'

import type { ScopedDb } from '~/runtime'
import { loadThresholds } from '~/wake/learning/thresholds'
import { LEARNING_TRIAGE_JOB, type LearningTriageJobPayload } from '~/wake/learning/triage-job'
import { renderMessageLine } from './summarize-content'

// ─── Public types ─────────────────────────────────────────────────────────────

/** Reasons the manual pass can refuse to run. Handlers map these to HTTP status. */
export type ManualLearningErrorCode = 'conversation_not_found' | 'no_agent'

export class ManualLearningError extends Error {
  constructor(
    readonly code: ManualLearningErrorCode,
    message: string,
  ) {
    super(message)
    this.name = 'ManualLearningError'
  }
}

/** Narrow port: enqueues one `learning:triage` job per window. */
export interface ManualLearningTriageScheduler {
  publish(name: string, payload: LearningTriageJobPayload): Promise<void>
}

export interface TriggerManualLearningInput {
  conversationId: string
  /** Explicit agent override; otherwise resolved from assignee → channel default. */
  agentId?: string
}

export interface ManualLearningResult {
  /** Agent the learning was attributed to. */
  agentId: string
  /** Number of triage jobs enqueued (one per window). */
  windowCount: number
  /** Messages actually covered (after the cost cap). */
  messageCount: number
}

export interface ManualLearningService {
  triggerLearning(input: TriggerManualLearningInput): Promise<ManualLearningResult>
}

// ─── Factory ──────────────────────────────────────────────────────────────────

export function createManualLearningService(deps: {
  db: ScopedDb
  triageScheduler: ManualLearningTriageScheduler
}): ManualLearningService {
  const { db, triageScheduler } = deps

  async function resolveAgentId(
    explicit: string | undefined,
    conv: { channelInstanceId: string; assignee: string },
  ): Promise<string | null> {
    if (explicit) return explicit
    if (conv.assignee.startsWith('agent:')) return conv.assignee.slice('agent:'.length)

    const ciRows = await db
      .select({ config: channelInstances.config })
      .from(channelInstances)
      .where(eq(channelInstances.id, conv.channelInstanceId))
      .limit(1)
    const cfg = ciRows[0]?.config as { defaultAssignee?: unknown } | undefined
    const def = typeof cfg?.defaultAssignee === 'string' ? cfg.defaultAssignee : null
    if (def?.startsWith('agent:')) return def.slice('agent:'.length)
    return null
  }

  async function triggerLearning(input: TriggerManualLearningInput): Promise<ManualLearningResult> {
    const { conversationId } = input
    const thresholds = loadThresholds()

    const convRows = await db
      .select({
        organizationId: conversations.organizationId,
        channelInstanceId: conversations.channelInstanceId,
        assignee: conversations.assignee,
      })
      .from(conversations)
      .where(eq(conversations.id, conversationId))
      .limit(1)
    const conv = convRows[0]
    if (!conv) {
      throw new ManualLearningError('conversation_not_found', `conversation ${conversationId} not found`)
    }

    const agentId = await resolveAgentId(input.agentId, conv)
    if (!agentId) {
      throw new ManualLearningError(
        'no_agent',
        `no agent resolved for conversation ${conversationId} — pass an agentId, assign the conversation, or set the channel's default agent`,
      )
    }

    // Load the most-recent `cap` messages (cost guard for 6-month threads), then
    // restore chronological order so windows read front-to-back.
    const cap = Math.max(1, thresholds.manualWindowSize * thresholds.manualMaxWindows)
    const recentDesc = await db
      .select({ id: messages.id, role: messages.role, kind: messages.kind, content: messages.content })
      .from(messages)
      .where(eq(messages.conversationId, conversationId))
      .orderBy(desc(messages.createdAt))
      .limit(cap + 1)

    const truncated = recentDesc.length > cap
    if (truncated) {
      console.info(
        { conversationId, cap },
        '[manual-learning] thread exceeds the window cap — learning from the most recent slice only',
      )
    }
    const ordered = (truncated ? recentDesc.slice(0, cap) : recentDesc).reverse()

    const windowSize = Math.max(1, thresholds.manualWindowSize)
    let windowCount = 0
    for (let start = 0; start < ordered.length; start += windowSize) {
      const window = ordered.slice(start, start + windowSize)
      const body = window.map(renderMessageLine).join('\n').trim()
      if (!body) continue
      const windowRef = `manual:w${windowCount}:${window[0]?.id ?? start}`
      await triageScheduler.publish(LEARNING_TRIAGE_JOB, {
        organizationId: conv.organizationId,
        agentId,
        conversationId,
        signal: { kind: 'manual', windowRef, body },
      })
      windowCount++
    }

    return { agentId, windowCount, messageCount: ordered.length }
  }

  return { triggerLearning }
}

// ─── Singleton install / reset ────────────────────────────────────────────────

let _current: ManualLearningService | null = null

export function installManualLearningService(svc: ManualLearningService): void {
  _current = svc
}

export function __resetManualLearningServiceForTests(): void {
  _current = null
}

function current(): ManualLearningService {
  if (!_current) {
    throw new Error(
      'messaging/manual-learning: service not installed — call installManualLearningService() in module init',
    )
  }
  return _current
}

// ─── Top-level facade (singleton pass-through) ────────────────────────────────

export function triggerLearning(input: TriggerManualLearningInput): Promise<ManualLearningResult> {
  return current().triggerLearning(input)
}
