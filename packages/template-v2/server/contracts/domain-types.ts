/**
 * Hand-written domain types shared by contracts (ports) AND Drizzle schemas.
 * Drizzle schemas assert `InferSelectModel<typeof table> extends DomainType` so drift
 * surfaces at typecheck instead of in Phase 2 bug reports.
 *
 * Drizzle schemas assert `InferSelectModel<typeof table> extends DomainType` so drift
 * surfaces at typecheck.
 */

export type ConversationStatus = 'active' | 'resolving' | 'awaiting_approval' | 'resolved' | 'failed'

export interface Conversation {
  id: string
  organizationId: string
  contactId: string
  channelInstanceId: string
  status: ConversationStatus
  assignee: string
  /** Chat channels default `'default'`; email populates from RFC 5322 thread root. */
  threadKey: string
  /** Email-only subject; null for non-email channels. */
  emailSubject: string | null
  snoozedUntil: Date | null
  snoozedReason: string | null
  snoozedBy: string | null
  snoozedAt: Date | null
  snoozedJobId: string | null
  lastMessageAt: Date | null
  resolvedAt: Date | null
  resolvedReason: string | null
  createdAt: Date
  updatedAt: Date
}

export type MessageRole = 'customer' | 'agent' | 'system' | 'staff'
export type MessageKind = 'text' | 'image' | 'card' | 'card_reply'

export interface Message {
  id: string
  conversationId: string
  organizationId: string
  role: MessageRole
  kind: MessageKind
  content: unknown
  parentMessageId: string | null
  channelExternalId: string | null
  status: string | null
  createdAt: Date
}

export type InternalNoteAuthorType = 'agent' | 'staff' | 'system'

export interface InternalNote {
  id: string
  organizationId: string
  conversationId: string
  authorType: InternalNoteAuthorType
  authorId: string
  body: string
  mentions: string[]
  parentNoteId: string | null
  notifChannelMsgId: string | null
  notifChannelId: string | null
  createdAt: Date
}

export type ApprovalStatus = 'pending' | 'approved' | 'rejected' | 'expired'

export interface PendingApproval {
  id: string
  organizationId: string
  conversationId: string
  conversationEventId: string | null
  toolName: string
  toolArgs: unknown
  status: ApprovalStatus
  decidedByUserId: string | null
  decidedAt: Date | null
  decidedNote: string | null
  agentSnapshot: unknown
  createdAt: Date
}

export interface Contact {
  id: string
  organizationId: string
  displayName: string | null
  phone: string | null
  email: string | null
  workingMemory: string
  segments: string[]
  marketingOptOut: boolean
  marketingOptOutAt: Date | null
  createdAt: Date
  updatedAt: Date
}

export interface StaffBinding {
  userId: string
  channelInstanceId: string
  externalIdentifier: string
  createdAt: Date
}

export interface AgentDefinition {
  id: string
  organizationId: string
  name: string
  soulMd: string
  model: string
  maxSteps: number | null
  workingMemory: string
  skillAllowlist: string[] | null
  cardApprovalRequired: boolean
  fileApprovalRequired: boolean
  bookSlotApprovalRequired: boolean
  maxOutputTokens: number | null
  maxInputTokens: number | null
  maxTurnsPerWake: number | null
  softCostCeilingUsd: string | null
  hardCostCeilingUsd: string | null
  enabled: boolean
  createdAt: Date
  updatedAt: Date
}

export type DriveKind = 'folder' | 'file'
export type DriveScopeName = 'organization' | 'contact'
export type DriveSource = 'customer_inbound' | 'agent_uploaded' | 'staff_uploaded' | 'admin_uploaded' | null
export type DriveProcessingStatus = 'pending' | 'processing' | 'ready' | 'failed'

export interface DriveFile {
  id: string
  organizationId: string
  scope: DriveScopeName
  scopeId: string
  parentFolderId: string | null
  kind: DriveKind
  name: string
  path: string
  mimeType: string | null
  sizeBytes: number | null
  storageKey: string | null
  caption: string | null
  captionModel: string | null
  captionUpdatedAt: Date | null
  extractedText: string | null
  source: DriveSource
  sourceMessageId: string | null
  tags: string[]
  uploadedBy: string | null
  processingStatus: DriveProcessingStatus
  processingError: string | null
  threatScanReport: unknown
  createdAt: Date
  updatedAt: Date
}

export type LearningScope = 'contact' | 'agent_memory' | 'agent_skill' | 'drive_doc'
export type LearningAction = 'upsert' | 'create' | 'patch'
export type LearningStatus = 'pending' | 'approved' | 'rejected' | 'superseded' | 'auto_written'

export interface LearningProposal {
  id: string
  organizationId: string
  conversationId: string
  wakeEventId: number | null
  scope: LearningScope
  action: LearningAction
  target: string
  body: string | null
  rationale: string | null
  confidence: number | null
  status: LearningStatus
  decidedByUserId: string | null
  decidedAt: Date | null
  decidedNote: string | null
  approvedWriteId: string | null
  createdAt: Date
}

/**
 * Markdown section materialised under `agent_memory.working_memory` whenever a
 * learning proposal is rejected. Anti-lessons live as a `## Anti-lessons` section
 * (not a column), keyed by `<proposal target>: <decidedNote>`. Consumed by the
 * `learn.propose` LLM input and the system prompt rule that tells the agent
 * "DO NOT re-propose these topics".
 */
export interface AgentMemoryAntiLessons {
  /** Heading always equals `Anti-lessons`. */
  readonly heading: 'Anti-lessons'
  /** One entry per rejected proposal — appended on rejection, never mutated. */
  entries: ReadonlyArray<{
    /** The proposal's `target` field — what the LLM should not re-propose. */
    target: string
    /** The proposal scope so the rule applies only to matching scope next turn. */
    scope: LearningScope
    /** Staff's `decided_note` — the reason teaches the LLM why the topic was bad. */
    note: string
    /** ISO8601 stamp so the section can be age-weighted later. */
    rejectedAt: string
  }>
}

export type ModerationCategory = 'hate' | 'harassment' | 'violence' | 'sexual' | 'prompt_injection' | 'policy_violation'

export interface AgentScore {
  id: string
  organizationId: string
  conversationId: string
  wakeTurnIndex: number
  scorer: string
  score: number
  rationale: string | null
  model: string | null
  createdAt: Date
}

/**
 * The append-only journal row. One row per `AgentEvent` plus per-event columns that
 * slightly widen the event-union payload (hermes-shaped fields like reasoning,
 * tool_calls, finish_reason).
 */
export interface ConversationEvent {
  id: number
  conversationId: string
  organizationId: string
  turnIndex: number
  ts: Date
  type: string
  role: string | null
  content: string | null
  toolCallId: string | null
  toolCalls: unknown
  toolName: string | null
  reasoning: string | null
  reasoningDetails: unknown
  tokenCount: number | null
  finishReason: string | null
  llmTask: string | null
  tokensIn: number | null
  tokensOut: number | null
  cacheReadTokens: number | null
  costUsd: string | null
  latencyMs: number | null
  model: string | null
  provider: string | null
  wakeId: string | null
  payload: unknown
}
