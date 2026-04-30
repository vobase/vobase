export interface MessageRow {
  id: string
  conversationId: string
  messageType: string
  contentType: string
  content: string
  contentData: Record<string, unknown> | null
  status: string | null
  failureReason: string | null
  senderId: string
  senderType: string
  channelType: string | null
  private: boolean
  withdrawn: boolean
  replyToMessageId: string | null
  resolutionStatus: string | null
  createdAt: string
}

export interface SenderInfo {
  name: string
  image?: string | null
}

export interface TimelineConversation {
  id: string
  status: string
  outcome: string | null
  startedAt: string
  resolvedAt: string | null
  reopenCount: number
}

export interface TimelineConversationFull extends TimelineConversation {
  priority: string | null
  assignee: string | null
  onHold: boolean
  channelInstanceId: string
  channelType: string
  channelLabel: string | null
}
