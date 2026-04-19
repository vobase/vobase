/**
 * InboxPort — consumed by other modules. All writes flow through the
 * `modules/inbox/service/` layer with transactional event-journal appends.
 */

import type { Conversation, InternalNote, Message, PendingApproval } from './domain-types'

export interface AuthorRefAgent {
  kind: 'agent'
  id: string
}
export interface AuthorRefUser {
  kind: 'user'
  id: string
}
export type AuthorRef = AuthorRefAgent | AuthorRefUser

export type AssigneeRef = AuthorRef | { kind: 'unassigned' }

export interface CreateConversationInput {
  tenantId: string
  contactId: string
  channelInstanceId: string
  status: Conversation['status']
  assignee: string
}

export interface SendTextInput {
  conversationId: string
  tenantId: string
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
  tenantId: string
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
  tenantId: string
  author: AuthorRef
  storageKey: string
  caption?: string
}

export interface SendMediaInput {
  conversationId: string
  tenantId: string
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
  tenantId: string
  channelInstanceId: string
  contactId: string
  externalMessageId: string
  content: string
  contentType: InboundContentType
  profileName?: string
}

export interface CreateInboundMessageResult {
  conversation: Conversation
  message: Message
  /** false when externalMessageId was already seen — idempotent replay. */
  isNew: boolean
}

export interface AddNoteInput {
  conversationId: string
  tenantId: string
  author: { kind: 'agent' | 'staff' | 'system'; id: string }
  body: string
  mentions?: string[]
  parentNoteId?: string
}

export interface InsertPendingApprovalInput {
  tenantId: string
  conversationId: string
  conversationEventId: string | null
  toolName: string
  toolArgs: unknown
  agentSnapshot: unknown
}

/** Opaque transaction handle passed through from Drizzle. */
export type Tx = unknown

export interface SendCardReplyInput {
  parentMessageId: string
  buttonId: string
  buttonValue: string
  buttonLabel?: string
}

export interface InboxPort {
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

  // state transitions (applyTransition internally)
  resolve(conversationId: string, reason: string, by: AuthorRef): Promise<void>
  reassign(conversationId: string, to: AssigneeRef, note?: string): Promise<void>
  hold(conversationId: string, reason: string): Promise<void>
  reopen(conversationId: string): Promise<void>

  // internal notes
  addInternalNote(input: AddNoteInput): Promise<InternalNote>
  listInternalNotes(conversationId: string): Promise<InternalNote[]>

  // pending approvals — inserted by approvalMutator
  insertPendingApproval(input: InsertPendingApprovalInput, tx?: Tx): Promise<PendingApproval>

  // compaction
  beginCompaction(conversationId: string, summary: string): Promise<{ childConversationId: string }>

  // inbound channel write path (one-write-path discipline)
  createInboundMessage(input: CreateInboundMessageInput): Promise<CreateInboundMessageResult>
}
