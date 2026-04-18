/**
 * Hand-written domain types shared by contracts (ports) AND Drizzle schemas.
 * Drizzle schemas assert `InferSelectModel<typeof table> extends DomainType` so drift
 * surfaces at typecheck instead of in Phase 2 bug reports.
 *
 * Spec §5 is the source of truth for shape; this file is its typed mirror.
 */

export type ConversationStatus =
  | 'active'
  | 'resolving'
  | 'resolved'
  | 'compacted'
  | 'archived'
  | 'awaiting_approval'
  | 'failed'

export interface Conversation {
  id: string
  tenantId: string
  contactId: string
  channelInstanceId: string
  parentConversationId: string | null
  compactionSummary: string | null
  compactedAt: Date | null
  status: ConversationStatus
  assignee: string
  onHold: boolean
  onHoldReason: string | null
  lastMessageAt: Date | null
  resolvedAt: Date | null
  resolvedReason: string | null
  createdAt: Date
  updatedAt: Date
}

export type MessageRole = 'customer' | 'agent' | 'system'
export type MessageKind = 'text' | 'image' | 'card' | 'card_reply'

export interface Message {
  id: string
  conversationId: string
  tenantId: string
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
  tenantId: string
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
  tenantId: string
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
  tenantId: string
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
  tenantId: string
  name: string
  soulMd: string
  model: string
  maxSteps: number | null
  workingMemory: string
  skillAllowlist: string[] | null
  cardApprovalRequired: boolean
  fileApprovalRequired: boolean
  bookSlotApprovalRequired: boolean
  enabled: boolean
  createdAt: Date
  updatedAt: Date
}

export type DriveKind = 'folder' | 'file'
export type DriveScopeName = 'tenant' | 'contact'
export type DriveSource = 'customer_inbound' | 'agent_uploaded' | 'staff_uploaded' | 'admin_uploaded' | null
export type DriveProcessingStatus = 'pending' | 'processing' | 'ready' | 'failed'

export interface DriveFile {
  id: string
  tenantId: string
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
  tenantId: string
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
 * The append-only journal row. One row per `AgentEvent` plus per-event columns that
 * slightly widen the event-union payload (hermes-shaped fields like reasoning,
 * tool_calls, finish_reason). See spec §5.3.
 */
export interface ConversationEvent {
  id: number
  conversationId: string
  tenantId: string
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
