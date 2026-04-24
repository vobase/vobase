import { z } from 'zod'

// ─── Content Type Discriminants ────────────────────────────────────
// These types must stay in sync with the CHECK constraints in schema.ts
// (messages_type_check, messages_content_type_check, messages_sender_type_check,
//  messages_status_check, messages_resolution_status_check).

export type MessageType = 'incoming' | 'outgoing' | 'activity'
export type SenderType = 'contact' | 'user' | 'agent' | 'system'
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
  | 'reaction'
  | 'button_reply'
  | 'list_reply'
  | 'unsupported'
  | 'system'
export type ResolutionStatus = 'pending' | 'reviewed' | 'dismissed'

// ─── Zod Schemas ───────────────────────────────────────────────────

export const withdrawMessageSchema = z.object({
  withdrawn: z.literal(true),
})
