/**
 * Canonical channel event schemas — spec §14.
 *
 * Both channel-web and channel-whatsapp parse their raw payloads into these shapes.
 * The scheduler and dispatcher key off these — without a shared shape each channel
 * would invent its own.
 */

import { z } from 'zod'

/** Outbound-facing tool names — dispatchers, senders, and the wake worker all key off this list. */
export const OUTBOUND_TOOL_NAMES = ['reply', 'send_card', 'send_file'] as const
export type OutboundToolName = (typeof OUTBOUND_TOOL_NAMES)[number]
export const OUTBOUND_TOOL_NAME_SET: ReadonlySet<string> = new Set(OUTBOUND_TOOL_NAMES)

// ─── Inbound ────────────────────────────────────────────────────────────────

export const ChannelInboundEventSchema = z.object({
  /** Resolved tenant scope (from webhook signature / session). */
  tenantId: z.string(),
  /** Channel that delivered the message. */
  channelType: z.enum(['web', 'whatsapp']),
  /** Provider-assigned message ID — used for idempotent dedup. */
  externalMessageId: z.string(),
  /** Sender address (phone number for WA, session token for web). */
  from: z.string(),
  /** Display name from the channel profile (empty string if unavailable). */
  profileName: z.string().default(''),
  /** Resolved contact ID if already known; undefined until resolver runs. */
  contactId: z.string().optional(),
  /** Resolved conversation ID if a live conversation already exists. */
  conversationId: z.string().optional(),
  /** Primary text payload. */
  content: z.string(),
  contentType: z
    .enum(['text', 'image', 'document', 'audio', 'video', 'button_reply', 'list_reply', 'unsupported'])
    .default('text'),
  /** Unix epoch ms. */
  timestamp: z.number(),
  /** Channel-specific extra fields (preserved for passthrough). */
  metadata: z.record(z.string(), z.unknown()).optional(),
})

export type ChannelInboundEvent = z.infer<typeof ChannelInboundEventSchema>

// ─── Outbound ───────────────────────────────────────────────────────────────

export const ChannelOutboundEventSchema = z.object({
  tenantId: z.string(),
  conversationId: z.string(),
  /** Resolved contact ID for address lookup. */
  contactId: z.string(),
  /** Wake that produced this outbound dispatch. Carried for audit_wake_map (A7). */
  wakeId: z.string(),
  channelType: z.enum(['web', 'whatsapp']),
  /** Tool that triggered the send. */
  toolName: z.enum(OUTBOUND_TOOL_NAMES),
  /** Serialised tool result payload — shape is tool-specific. */
  payload: z.unknown(),
})

export type ChannelOutboundEvent = z.infer<typeof ChannelOutboundEventSchema>
