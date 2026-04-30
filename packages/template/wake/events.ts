/**
 * Canonical `AgentEvent` union.
 *
 * Every event flowing through `EventBus`, `ObserverBus`, and the `conversation_events`
 * journal is one of these variants. The journal's write path lives exclusively in
 * `modules/agents/service/journal.ts` (one write path per domain).
 */

import type { ClassifiedErrorReason } from '@vobase/core'

/**
 * Concierge triggers (always conversation-bound) plus operator triggers
 * (thread- or schedule-bound). Operator wakes carry a synthetic
 * `conversationId` of the form `operator-<threadId>` or `heartbeat-<scheduleId>`
 * downstream so the journal contract (`BaseEvent.conversationId: string`)
 * stays satisfied without a schema migration. Producers should not invent
 * the synthetic id — `wake/operator-thread-handler.ts` and `wake/heartbeat.ts`
 * own the mapping.
 */
export type WakeTrigger =
  | { trigger: 'inbound_message'; conversationId: string; messageIds: string[] }
  | {
      trigger: 'approval_resumed'
      conversationId: string
      approvalId: string
      decision: 'approved' | 'rejected'
      note?: string
    }
  | {
      trigger: 'supervisor'
      conversationId: string
      noteId: string
      authorUserId: string
      /**
       * Set when staff @-mentioned a specific agent in the note. Causes the
       * peer wake to boot that agent's own builder rather than the conversation
       * assignee. Undefined for the assignee self-wake variant. Resolved at
       * `addNote` post-commit fan-out time; never mutated downstream.
       */
      mentionedAgentId?: string
    }
  | { trigger: 'scheduled_followup'; conversationId: string; reason: string; scheduledAt: Date; sourceWakeId?: string }
  | { trigger: 'manual'; conversationId: string; reason: string; actorUserId: string }
  | { trigger: 'operator_thread'; threadId: string; messageIds: string[] }
  | { trigger: 'heartbeat'; scheduleId: string; intendedRunAt: Date; reason: string }

export type WakeTriggerKind = WakeTrigger['trigger']

/**
 * Concierge-only triggers — every variant carries `conversationId`. The wake
 * scheduler/worker pipeline is conversation-bound, so consumer payloads
 * (`AgentWakeJobPayload`, `ScheduledFollowupPayload`) narrow to this subset.
 * Operator wakes (`operator_thread`, `heartbeat`) bypass the scheduler and
 * dispatch through `wake/operator-thread-handler.ts` / `wake/heartbeat.ts`.
 */
export type ConciergeWakeTrigger = Exclude<WakeTrigger, { trigger: 'operator_thread' | 'heartbeat' }>

/** Task tag threaded through every LLM call — see `PluginContext.llmCall()`. */
export type LlmTask =
  | 'agent.turn'
  | 'scorer.answer_relevancy'
  | 'scorer.faithfulness'
  | 'moderation'
  | 'memory.distill'
  | 'learn.propose'
  | 'drive.caption.image'
  | 'drive.caption.video'
  | 'drive.extract.pdf'
  | 'intent.classify'

export type AgentEndReason = 'complete' | 'blocked' | 'aborted' | 'error'

interface BaseEvent {
  ts: Date
  /** Stable identifier for the specific wake that produced this event. */
  wakeId: string
  conversationId: string
  organizationId: string
  turnIndex: number
}

export type AgentStartEvent = BaseEvent & {
  type: 'agent_start'
  agentId: string
  trigger: WakeTriggerKind
  triggerPayload: WakeTrigger
  systemHash: string
}

export type TurnStartEvent = BaseEvent & { type: 'turn_start' }
export type TurnEndEvent = BaseEvent & {
  type: 'turn_end'
  tokensIn: number
  tokensOut: number
  costUsd: number
}

export type MessageStartEvent = BaseEvent & {
  type: 'message_start'
  messageId: string
  role: 'assistant' | 'tool' | 'user' | 'system'
}
export type MessageUpdateEvent = BaseEvent & {
  type: 'message_update'
  messageId: string
  delta: string
}
export type MessageEndEvent = BaseEvent & {
  type: 'message_end'
  messageId: string
  role: 'assistant' | 'tool' | 'user' | 'system'
  content: string
  reasoning?: string
  tokenCount?: number
  finishReason?: string
}

export type ToolExecutionStartEvent = BaseEvent & {
  type: 'tool_execution_start'
  toolCallId: string
  toolName: string
  args: unknown
}
export type ToolExecutionUpdateEvent = BaseEvent & {
  type: 'tool_execution_update'
  toolCallId: string
  update: unknown
}
export type ToolExecutionEndEvent = BaseEvent & {
  type: 'tool_execution_end'
  toolCallId: string
  toolName: string
  result: unknown
  isError: boolean
  latencyMs: number
}

export type LlmCallEvent = BaseEvent & {
  type: 'llm_call'
  task: LlmTask
  model: string
  provider: string
  tokensIn: number
  tokensOut: number
  cacheReadTokens: number
  costUsd: number
  latencyMs: number
  cacheHit: boolean
}

export type AgentEndEvent = BaseEvent & {
  type: 'agent_end'
  reason: AgentEndReason
}

export type ApprovalRequestedEvent = BaseEvent & {
  type: 'approval_requested'
  approvalId: string
  toolName: string
}
export type ApprovalDecidedEvent = BaseEvent & {
  type: 'approval_decided'
  approvalId: string
  decision: 'approved' | 'rejected'
  decidedByUserId: string
}

export type InternalNoteAddedEvent = BaseEvent & {
  type: 'internal_note_added'
  noteId: string
  authorType: 'agent' | 'staff' | 'system'
}

// ─── Channel + Scheduler events (Phase 2) ───────────────────────────────────
// Note: tool_call_start/tool_call_end are intentionally absent — the existing
// tool_execution_start/end cover this seam; renaming would collide with Phase 1
// test fixtures.

export type ChannelInboundAgentEvent = BaseEvent & {
  type: 'channel_inbound'
  /** Channel that delivered the message (e.g. 'web', 'whatsapp'). */
  channelType: string
  /** Provider-assigned message ID — used for idempotent dedup. */
  externalMessageId: string
  /** Resolved contact ID if available at event emission time. */
  contactId?: string
}

export type ChannelOutboundAgentEvent = BaseEvent & {
  type: 'channel_outbound'
  channelType: string
  /** Tool that triggered the outbound dispatch (e.g. 'reply', 'send_card'). */
  toolName: string
  contactId: string
}

export type WakeScheduledEvent = BaseEvent & {
  type: 'wake_scheduled'
  trigger: WakeTriggerKind
  scheduledAt: Date
  /** Wake that scheduled this one (present for scheduled_followup chains). */
  sourceWakeId?: string
}

// ─── Change-proposal events ────────────────────────────────────────────────

export type ChangeProposedEvent = BaseEvent & {
  type: 'change_proposed'
  proposalId: string
  resourceModule: string
  resourceType: string
}
export type ChangeApprovedEvent = BaseEvent & {
  type: 'change_approved'
  proposalId: string
  writeId: string
}
export type ChangeRejectedEvent = BaseEvent & {
  type: 'change_rejected'
  proposalId: string
  reason: string
}

// ─── Budget / abort / cache events ──────────────────────────────────────────

export type BudgetWarningEvent = BaseEvent & {
  type: 'budget_warning'
  /** 'soft' = ≥70% threshold; 'hard' = ≥100% threshold (loop broken). */
  phase: 'soft' | 'hard'
  turnsConsumed: number
  spentUsd: number
}

export type ErrorClassifiedEvent = BaseEvent & {
  type: 'error_classified'
  reason: ClassifiedErrorReason
  providerMessage: string
  httpStatus?: number
  retryAttempt: number
}

export type ToolResultPersistedEvent = BaseEvent & {
  type: 'tool_result_persisted'
  toolCallId: string
  toolName: string
  /** Absolute path inside /tmp/ where the full result was spilled. */
  path: string
  originalByteLength: number
}

export type SteerInjectedEvent = BaseEvent & {
  type: 'steer_injected'
  /** The steer text injected as the next user message. */
  text: string
}

export type WakeRefusedEvent = BaseEvent & {
  type: 'wake_refused'
  reason: 'daily_ceiling'
}

export type AgentAbortedEvent = BaseEvent & {
  type: 'agent_aborted'
  /** Human-readable reason string from `AbortContext.reason` (or 'external' if unset). */
  reason: string
  /**
   * Where in the turn the abort was detected.
   * 'pre_tool'  — before any tool call started (includes LLM stream phase).
   * 'in_tool'   — while a tool was executing (tool ran to completion).
   * 'post_tool' — after a tool completed, before the next one started.
   * Lets restart-recovery distinguish intentional abort from crash.
   */
  abortedAt: 'pre_tool' | 'in_tool' | 'post_tool'
}

// ─── Moderation + scorer events (Phase 3) ───────────────────────────────────

export type ModerationBlockedEvent = BaseEvent & {
  type: 'moderation_blocked'
  /** Tool call that triggered the block (matches approval_requested.toolName convention). */
  toolName: string
  toolCallId: string
  /** Rule that fired — e.g. 'policy.refund_cap', 'threat.prompt_injection'. */
  ruleId: string
  reason: string
}

export type ScorerRecordedEvent = BaseEvent & {
  type: 'scorer_recorded'
  /** Matches `modules/agents/schema.ts agent_scores.scorer_id` (e.g. 'answer_relevancy'). */
  scorerId: string
  /** 0..1 range — enforced by the observer writing the row. */
  score: number
  /** Link back to the LLM call that produced the rating (scorer_recorded fires after the scorer's own `llm_call`). */
  sourceLlmTask: LlmTask
}

export type AgentEvent =
  | AgentStartEvent
  | TurnStartEvent
  | TurnEndEvent
  | MessageStartEvent
  | MessageUpdateEvent
  | MessageEndEvent
  | ToolExecutionStartEvent
  | ToolExecutionUpdateEvent
  | ToolExecutionEndEvent
  | LlmCallEvent
  | AgentEndEvent
  | ApprovalRequestedEvent
  | ApprovalDecidedEvent
  | InternalNoteAddedEvent
  | ChangeProposedEvent
  | ChangeApprovedEvent
  | ChangeRejectedEvent
  | ModerationBlockedEvent
  | ScorerRecordedEvent
  | ChannelInboundAgentEvent
  | ChannelOutboundAgentEvent
  | WakeScheduledEvent
  | BudgetWarningEvent
  | ErrorClassifiedEvent
  | ToolResultPersistedEvent
  | SteerInjectedEvent
  | WakeRefusedEvent
  | AgentAbortedEvent

export type AgentEventType = AgentEvent['type']
