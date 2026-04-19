/**
 * InboxPort implementation — binds service methods to the typed port contract.
 * REAL: createConversation, insertPendingApproval, sendTextMessage, sendCardMessage,
 *       sendMediaMessage, createInboundMessage.
 */
import type {
  InboxPort,
  SendCardInput,
  SendCardReplyInput,
  SendMediaInput,
  SendTextInput,
} from '@server/contracts/inbox-port'
import { conversations, notes, pendingApprovals } from './service'
import { appendCardMessage, appendCardReplyMessage, appendMediaMessage, appendTextMessage } from './service/messages'

export function createInboxPort(): InboxPort {
  return {
    async getConversation(id) {
      return conversations.get(id)
    },
    async listMessages(conversationId, opts) {
      const { list } = await import('./service/messages')
      return list(conversationId, opts)
    },
    async createConversation(input) {
      return conversations.create(input)
    },
    async sendTextMessage(input: SendTextInput) {
      return appendTextMessage({
        conversationId: input.conversationId,
        tenantId: input.tenantId,
        agentId: input.agentId ?? (input.author.kind === 'agent' ? input.author.id : 'system'),
        wakeId: input.wakeId ?? 'direct',
        turnIndex: input.turnIndex ?? 0,
        toolCallId: input.toolCallId ?? `direct-${Date.now()}`,
        text: input.body,
        replyToMessageId: input.parentMessageId,
      })
    },
    async sendCardReply(input: SendCardReplyInput) {
      return appendCardReplyMessage({
        parentMessageId: input.parentMessageId,
        buttonId: input.buttonId,
        buttonValue: input.buttonValue,
        buttonLabel: input.buttonLabel,
      })
    },
    async sendCardMessage(input: SendCardInput) {
      return appendCardMessage({
        conversationId: input.conversationId,
        tenantId: input.tenantId,
        agentId: input.agentId ?? (input.author.kind === 'agent' ? input.author.id : 'system'),
        wakeId: input.wakeId ?? 'direct',
        turnIndex: input.turnIndex ?? 0,
        toolCallId: input.toolCallId ?? `direct-${Date.now()}`,
        card: input.card,
        replyToMessageId: input.parentMessageId,
      })
    },
    async sendImageMessage() {
      throw new Error('inbox.sendImageMessage: not implemented — use sendMediaMessage')
    },
    async sendMediaMessage(input: SendMediaInput) {
      return appendMediaMessage({
        conversationId: input.conversationId,
        tenantId: input.tenantId,
        agentId: input.agentId ?? (input.author.kind === 'agent' ? input.author.id : 'system'),
        wakeId: input.wakeId ?? 'direct',
        turnIndex: input.turnIndex ?? 0,
        toolCallId: input.toolCallId ?? `direct-${Date.now()}`,
        driveFileId: input.driveFileId,
        caption: input.caption,
      })
    },
    async resolve(conversationId, reason, by) {
      return conversations.resolve(conversationId, reason, by)
    },
    async reassign(conversationId, to, note) {
      return conversations.reassign(conversationId, to, note)
    },
    async hold(conversationId, reason) {
      return conversations.hold(conversationId, reason)
    },
    async reopen(conversationId) {
      return conversations.reopen(conversationId)
    },
    async addInternalNote(input) {
      return notes.addNote(input)
    },
    async listInternalNotes(conversationId) {
      return notes.listNotes(conversationId)
    },
    async insertPendingApproval(input, tx) {
      return pendingApprovals.insert(input, tx)
    },
    async beginCompaction(conversationId, summary) {
      return conversations.beginCompaction(conversationId, summary)
    },
    async createInboundMessage(input) {
      return conversations.createInboundMessage(input)
    },
  }
}
