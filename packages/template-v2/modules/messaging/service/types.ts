/**
 * Messaging service types — input shapes, author references, and the MessagingPort interface.
 * Consumed by channels, agents, and the harness layer.
 */

import type { Tx } from '@server/common/port-types'
import type { Conversation, InternalNote, Message, PendingApproval } from '../schema'

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
}

export interface CreateInboundMessageResult {
  conversation: Conversation
  message: Message
  /** false when externalMessageId was already seen — idempotent replay. */
  isNew: boolean
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
  conversationId: string
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
