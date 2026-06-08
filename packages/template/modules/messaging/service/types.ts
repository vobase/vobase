/**
 * Messaging service types — input shapes, author references, and the MessagingPort interface.
 * Consumed by channels, agents, and the harness layer.
 */

import type { Tx } from '~/runtime'
import type { Conversation, InternalNote, Message, MessageRole, PendingApproval } from '../schema'
import type { MessageMetadata } from './echo-metadata'

export interface AuthorRefAgent {
  kind: 'agent'
  id: string
}
export interface AuthorRefUser {
  kind: 'user'
  id: string
}
export interface AuthorRefStaff {
  kind: 'staff'
  id: string
}
export type AuthorRef = AuthorRefAgent | AuthorRefUser | AuthorRefStaff

export type AssigneeRef = AuthorRef | { kind: 'unassigned' }

export interface CreateConversationInput {
  organizationId: string
  contactId: string
  channelInstanceId: string
  status: Conversation['status']
  assignee: string
  /** Defaults to `'default'` — chat channels always pass `'default'`; email passes the RFC 5322 thread root. */
  threadKey?: string
  /** Email-only — subject line of the thread root. */
  emailSubject?: string
}

export interface SendTextInput {
  conversationId: string
  organizationId: string
  author: AuthorRef
  body: string
  parentMessageId?: string
  /** Optional — dispatcher passes wakeId for journal correlation. */
  wakeId?: string
  agentId?: string
  toolCallId?: string
  turnIndex?: number
}

export interface SendCardInput {
  conversationId: string
  organizationId: string
  author: AuthorRef
  card: unknown
  parentMessageId?: string
  wakeId?: string
  agentId?: string
  toolCallId?: string
  turnIndex?: number
}

export interface SendImageInput {
  conversationId: string
  organizationId: string
  author: AuthorRef
  storageKey: string
  caption?: string
}

export interface SendMediaInput {
  conversationId: string
  organizationId: string
  author: AuthorRef
  driveFileId: string
  wakeId?: string
  agentId?: string
  toolCallId?: string
  turnIndex?: number
  caption?: string
}

export type InboundContentType =
  | 'text'
  | 'image'
  | 'document'
  | 'audio'
  | 'video'
  | 'button_reply'
  | 'list_reply'
  | 'unsupported'

export interface CreateInboundMessageInput {
  organizationId: string
  channelInstanceId: string
  contactId: string
  externalMessageId: string
  content: string
  contentType: InboundContentType
  profileName?: string
  /**
   * Thread-scoping key used to resolve the conversation row under
   * `UNIQUE(organization, contact, channelInstance, threadKey)`. Chat adapters
   * omit or pass `'default'`; the email adapter passes the RFC 5322
   * References root so each email topic gets its own conversation.
   */
  threadKey?: string
  /** Email-only — subject of the thread root (set on first inbound in a thread). */
  emailSubject?: string
  /**
   * Assignee to set when this inbound creates the conversation row. Ignored
   * when resuming an existing conversation. Channels resolve this from their
   * instance config (e.g. web's `defaultAssignee`). When absent, falls back
   * to `'unassigned'`.
   */
  initialAssignee?: string | null
  /**
   * Inbound binary attachments (e.g. WhatsApp documents/images/audio/video).
   *
   * **Trust boundary** — this field is intentionally NOT validated by Zod
   * (Buffer would fail validation, and logging the raw bytes would bloat
   * any payload trace). The contract is: `dispatchInbound` is the only
   * producer (it forwards `event.media` from `@vobase/core`'s
   * `MessageReceivedEvent`, which the channel adapter populates with the
   * downloaded bytes), and `createInboundMessage` is the only consumer
   * (it pre-writes drive rows via `ingestUpload` BEFORE opening the
   * message tx). No other caller may construct this field.
   */
  attachments?: Array<{
    bytes: Buffer
    name: string
    mimeType: string
    sizeBytes: number
  }>
  /**
   * Safe echo/status metadata subset. Populated by `extractEchoMetadata()` in
   * `dispatchInbound`; never the raw provider payload (PII boundary).
   */
  metadata?: MessageMetadata
  /**
   * Override message role. Defaults to `'customer'`. Slice D sets `'staff'`
   * for SMB echo events so they appear as outbound staff messages.
   */
  role?: MessageRole
}

export interface CreateInboundMessageResult {
  conversation: Conversation
  message: Message
  /** false when externalMessageId was already seen — idempotent replay. */
  isNew: boolean
}

/** One imported historical message destined for the backfill writer. */
export interface BackfillHistoryMessage {
  /** WhatsApp message id — the idempotency key. */
  wamid: string
  content: string
  contentType: InboundContentType
  /** `customer` (inbound) or `staff` (business-sent, outbound). */
  role: MessageRole
  /** Original device timestamp — written verbatim as the message `createdAt`. */
  occurredAt: Date
  metadata?: MessageMetadata
}

export interface BackfillHistoryInput {
  organizationId: string
  channelInstanceId: string
  contactId: string
  threadKey?: string
  messages: BackfillHistoryMessage[]
}

export interface BackfillHistoryResult {
  conversationId: string
  inserted: number
  /** Count of messages skipped as already-present (idempotent replay). */
  skipped: number
}

export interface ResolveImportedHistoryInput {
  organizationId: string
  channelInstanceId: string
  /**
   * Keep a pure-history thread `active` (instead of resolving it) when its most
   * recent message is an inbound customer message within this window — those are
   * genuinely-open tickets staff should triage at onboarding. Default 7 days.
   */
  keepActiveWindowMs?: number
  /** Injectable clock for the recency window; defaults to now. */
  now?: Date
}

export interface ResolveImportedHistoryResult {
  /** Pure-history conversations examined on this instance. */
  scanned: number
  /** Conversations transitioned to `resolved` (reason `history_import`). */
  resolved: number
  /** Conversations left `active` by the recent-inbound exception. */
  keptActive: number
}

export interface AttachHistoricalMediaInput {
  organizationId: string
  /** WhatsApp message id of the placeholder message to enrich. */
  wamid: string
  bytes: Buffer
  mimeType: string
  filename: string
}

export interface AttachHistoricalMediaResult {
  /** false when the placeholder message does not exist yet — the caller should retry. */
  found: boolean
  /** false when found but already had an attachment (idempotent). */
  updated: boolean
}

export interface AddNoteInput {
  conversationId: string
  organizationId: string
  author: { kind: 'agent' | 'staff' | 'system'; id: string }
  body: string
  mentions?: string[]
  parentNoteId?: string
}

export interface InsertPendingApprovalInput {
  organizationId: string
  /**
   * `null` for tools whose approval has no associated conversation yet
   * (`propose_outreach`). Conversation-bound tools (`reply`, `send_card`,
   * `send_file`, `draft_email_to_review`) always set this.
   */
  conversationId: string | null
  conversationEventId: string | null
  toolName: string
  toolArgs: unknown
  agentSnapshot: unknown
}

export interface SendCardReplyInput {
  parentMessageId: string
  buttonId: string
  buttonValue: string
  buttonLabel?: string
}

export interface SnoozeConversationInput {
  conversationId: string
  until: Date
  by: string
  reason?: string
}

export interface MessagingPort {
  // read
  getConversation(id: string): Promise<Conversation>
  listMessages(conversationId: string, opts?: { limit?: number; since?: Date }): Promise<Message[]>

  // write
  createConversation(input: CreateConversationInput): Promise<Conversation>
  sendTextMessage(input: SendTextInput): Promise<Message>
  sendCardMessage(input: SendCardInput): Promise<Message>
  sendCardReply(input: SendCardReplyInput): Promise<Message>
  sendImageMessage(input: SendImageInput): Promise<Message>
  sendMediaMessage(input: SendMediaInput): Promise<Message>

  // lifecycle (applyTransition internally, via state.ts)
  resolve(conversationId: string, reason: string, by: AuthorRef): Promise<void>
  reopen(conversationId: string): Promise<void>
  reset(conversationId: string, by: string): Promise<void>
  reassign(conversationId: string, to: AssigneeRef, note?: string): Promise<void>
  snooze(input: SnoozeConversationInput): Promise<Conversation>
  unsnooze(conversationId: string, by: string): Promise<Conversation>

  // internal notes
  addInternalNote(input: AddNoteInput): Promise<InternalNote>
  listInternalNotes(conversationId: string): Promise<InternalNote[]>

  // pending approvals — inserted by approvalMutator
  insertPendingApproval(input: InsertPendingApprovalInput, tx?: Tx): Promise<PendingApproval>

  // inbound channel write path (one-write-path discipline)
  createInboundMessage(input: CreateInboundMessageInput): Promise<CreateInboundMessageResult>
}

/**
 * Read-only slice of `MessagingPort` the agent-facing materializers depend on.
 * Defined here (not under `agent.ts`) so the type lives next to its
 * service-layer source-of-truth and `agent.ts` stays purely declarative.
 *
 * Drive-attachment lookups for `MESSAGES.md` enrichment go through
 * `messaging/service/drive-attachments.ts` directly (a separate module
 * function, not part of this read-slice) so existing `MessagingPort`
 * stubs in tests don't need to satisfy a new method.
 */
export type MessagingReader = Pick<MessagingPort, 'listMessages' | 'listInternalNotes'>

/**
 * Conversation lister the messaging `/INDEX.md` contributor reads from. Kept
 * minimal so callers can hand in either the live service or a stub.
 */
export interface MessagingIndexReader {
  list(organizationId: string, opts?: { tab?: 'active' | 'later' | 'done' }): Promise<Conversation[]>
}
