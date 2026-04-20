/**
 * InboxPort implementation — binds service methods to the typed port contract.
 * Model A: one row per (organization, contact, channelInstance); snooze orthogonal
 * to status; resolve/reopen/reset are explicit lifecycle verbs.
 */
import type {
  InboxPort,
  SendCardInput,
  SendCardReplyInput,
  SendMediaInput,
  SendTextInput,
  SnoozeConversationInput,
} from '@server/contracts/inbox-port'
import { conversations, notes, pendingApprovals } from './service'
import {
  appendCardMessage,
  appendCardReplyMessage,
  appendMediaMessage,
  appendStaffTextMessage,
  appendTextMessage,
} from './service/messages'

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
      if (input.author.kind === 'staff') {
        return appendStaffTextMessage({
          conversationId: input.conversationId,
          organizationId: input.organizationId,
          staffUserId: input.author.id,
          body: input.body,
        })
      }
      return appendTextMessage({
        conversationId: input.conversationId,
        organizationId: input.organizationId,
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
        organizationId: input.organizationId,
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
        organizationId: input.organizationId,
        agentId: input.agentId ?? (input.author.kind === 'agent' ? input.author.id : 'system'),
        wakeId: input.wakeId ?? 'direct',
        turnIndex: input.turnIndex ?? 0,
        toolCallId: input.toolCallId ?? `direct-${Date.now()}`,
        driveFileId: input.driveFileId,
        caption: input.caption,
      })
    },
    async resolve(conversationId, reason, by) {
      await conversations.resolve(conversationId, by.id, reason)
    },
    async reassign(conversationId, to, note) {
      const assignee = to.kind === 'unassigned' ? 'unassigned' : `${to.kind}:${to.id}`
      await conversations.reassign(conversationId, assignee, 'system', note)
    },
    async reopen(conversationId) {
      await conversations.reopen(conversationId, 'system', 'staff_reopen')
    },
    async reset(conversationId, by) {
      await conversations.reset(conversationId, by)
    },
    async snooze(input: SnoozeConversationInput) {
      return conversations.snooze(input)
    },
    async unsnooze(conversationId, by) {
      return conversations.unsnooze(conversationId, by)
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
    async createInboundMessage(input) {
      return conversations.createInboundMessage(input)
    },
  }
}
