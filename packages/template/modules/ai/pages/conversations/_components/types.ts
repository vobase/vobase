export interface MessageRow {
  id: string;
  conversationId: string;
  messageType: string;
  contentType: string;
  content: string;
  contentData: Record<string, unknown> | null;
  status: string | null;
  failureReason: string | null;
  senderId: string;
  senderType: string;
  channelType: string | null;
  private: boolean;
  withdrawn: boolean;
  resolutionStatus: string | null;
  createdAt: string;
}

export interface SenderInfo {
  name: string;
  image?: string | null;
}
