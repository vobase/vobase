import { z } from 'zod';

// ─── Content Type Discriminants ────────────────────────────────────
// These types must stay in sync with the CHECK constraints in schema.ts
// (messages_type_check, messages_content_type_check, messages_sender_type_check,
//  messages_status_check, messages_resolution_status_check).

export type MessageType = 'incoming' | 'outgoing' | 'activity';
export type SenderType = 'contact' | 'user' | 'agent' | 'system';
export type ContentType =
  | 'text'
  | 'image'
  | 'document'
  | 'audio'
  | 'video'
  | 'template'
  | 'interactive'
  | 'sticker'
  | 'email'
  | 'system';
export type MessageStatus = 'queued' | 'sent' | 'delivered' | 'read' | 'failed';
export type ResolutionStatus = 'pending' | 'reviewed' | 'dismissed';

// ─── ContentData Interfaces ────────────────────────────────────────

export interface MediaContentData {
  url: string;
  mimeType?: string;
  size?: number;
  filename?: string;
  caption?: string;
  thumbnailUrl?: string;
}

export interface TemplateContentData {
  templateName: string;
  templateLanguage?: string;
  components?: Record<string, unknown>[];
}

export interface InteractiveContentData {
  type: 'buttons' | 'list';
  body: string;
  buttons?: { id: string; title: string }[];
  sections?: {
    title: string;
    rows: { id: string; title: string; description?: string }[];
  }[];
  buttonText?: string;
}

export interface InteractiveReplyData {
  type: 'button_reply' | 'list_reply';
  selectedId: string;
  selectedTitle: string;
  selectedDescription?: string;
}

export interface EmailContentData {
  subject: string;
  from: string;
  to: string[];
  cc?: string[];
  bcc?: string[];
  htmlBody?: string;
  attachments?: { filename: string; url: string; mimeType: string }[];
}

export interface ActivityContentData {
  eventType: string;
  actor?: string;
  actorType?: SenderType;
  data?: Record<string, unknown>;
}

// ─── ContentData Discriminated Helper ──────────────────────────────

export type ContentDataByType<T extends ContentType> = T extends
  | 'image'
  | 'document'
  | 'audio'
  | 'video'
  | 'sticker'
  ? MediaContentData
  : T extends 'template'
    ? TemplateContentData
    : T extends 'interactive'
      ? InteractiveContentData & { interactiveReply?: InteractiveReplyData }
      : T extends 'email'
        ? EmailContentData
        : T extends 'system'
          ? ActivityContentData
          : Record<string, unknown>;

// ─── Zod Schemas ───────────────────────────────────────────────────

export const createMessageSchema = z.object({
  content: z.string().min(1),
  private: z.boolean().optional().default(false),
  contentType: z
    .enum([
      'text',
      'image',
      'document',
      'audio',
      'video',
      'template',
      'interactive',
      'sticker',
      'email',
      'system',
    ])
    .optional()
    .default('text'),
  contentData: z.record(z.string(), z.unknown()).optional(),
});

export const withdrawMessageSchema = z.object({
  withdrawn: z.literal(true),
});

export const messageQuerySchema = z.object({
  before: z.string().optional(),
  limit: z.coerce.number().int().min(1).max(100).optional().default(20),
  messageType: z.enum(['incoming', 'outgoing', 'activity']).optional(),
});
