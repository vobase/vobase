/**
 * channel-web module jobs.
 * `inboundToWake` — consumed by wake-scheduler (P2.4) to boot a conversation wake.
 */
import { z } from 'zod'

export const InboundToWakePayloadSchema = z.object({
  organizationId: z.string(),
  conversationId: z.string(),
  messageId: z.string(),
  contactId: z.string(),
})

export type InboundToWakePayload = z.infer<typeof InboundToWakePayloadSchema>

export const INBOUND_TO_WAKE_JOB = 'channel-web:inbound-to-wake'

export const jobs = [INBOUND_TO_WAKE_JOB] as const
