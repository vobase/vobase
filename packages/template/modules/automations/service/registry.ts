import { z } from 'zod'

// Phase 1 registry. Slice B adds the 5 notification events. For US-004
// only the `cron` event existed (producer: wake/heartbeat.ts). US-008
// extends with conversation_reassigned, approval_filed, approval_decided,
// proposal_filed, proposal_decided.
//
// To add an event: (a) add Zod schema below, (b) add a producer file path
// to scripts/check-emit.config.ts::EMIT_REGISTRY, (c) call `emit(name, payload, { tx })`
// at the producer call site.
//
// `conversationId` is `z.string().nullable()` for `approval_filed` so that
// outreach approvals (no conversation yet, see `propose_outreach`) can also
// emit; conversation-bound producers (`draft_email_to_review`) just pass a
// concrete id. Same nullable for `proposal_filed` / `proposal_decided` since
// standalone-lane proposals carry no conversation.

export const eventRegistry = {
  cron: z.object({
    scheduleId: z.string(),
    intendedRunAt: z.string(), // ISO timestamp
  }),

  conversation_reassigned: z.object({
    conversationId: z.string(),
    organizationId: z.string(),
    fromAssignee: z.string().nullable(),
    toAssignee: z.string(),
    reason: z.string().optional(),
  }),

  approval_filed: z.object({
    conversationId: z.string().nullable(),
    organizationId: z.string(),
    approvalId: z.string(),
    approvalSummary: z.string(),
    filedByAgentId: z.string(),
    // Recipient routing for the staff-ping side of approval_filed (Slice B.4
    // consumes this; for now it's just carried through).
    assigneeStaffUserId: z.string().nullable(),
  }),

  approval_decided: z.object({
    conversationId: z.string().nullable(),
    organizationId: z.string(),
    approvalId: z.string(),
    decision: z.enum(['approve', 'deny']),
    decidedByUserId: z.string(),
    decidedByLabel: z.string(),
    filedByAgentId: z.string(),
    note: z.string().optional(),
  }),

  proposal_filed: z.object({
    conversationId: z.string().nullable(),
    organizationId: z.string(),
    proposalId: z.string(),
    proposalSummary: z.string(),
    resourceModule: z.string(),
    resourceType: z.string(),
    proposedByAgentId: z.string(),
  }),

  proposal_decided: z.object({
    conversationId: z.string().nullable(),
    organizationId: z.string(),
    proposalId: z.string(),
    decision: z.enum(['approve', 'reject']),
    proposedByAgentId: z.string(),
    decidedByUserId: z.string(),
    note: z.string().optional(),
  }),
} as const

export type EventName = keyof typeof eventRegistry
export type EventPayload<E extends EventName> = z.infer<(typeof eventRegistry)[E]>
