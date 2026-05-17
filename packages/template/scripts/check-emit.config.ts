/**
 * Per-event-name → array of allowed producer file paths
 * (relative to packages/template/).
 *
 * Adding a producer: append to the matching array.
 * Adding a new event: add to events.ts registry + to a new entry here.
 *
 * Phase 1 (US-004): only `cron`. US-008 (Slice B.3) added the 5 notification
 * events with their producer call sites. `approval_filed` is emitted at the
 * agent-tool boundary (NOT pending-approvals.ts::insert) because that's where
 * `ctx.agentId` is in scope — see `draft-email-to-review.ts` and
 * `propose-outreach.ts`.
 */
export const EMIT_REGISTRY: Record<string, readonly string[]> = {
  cron: ['wake/heartbeat.ts'],
  conversation_reassigned: ['modules/messaging/service/conversations.ts'],
  approval_filed: ['modules/messaging/tools/draft-email-to-review.ts', 'modules/contacts/tools/propose-outreach.ts'],
  approval_decided: ['modules/messaging/service/pending-approvals.ts'],
  proposal_filed: ['modules/changes/service/proposals.ts'],
  proposal_decided: ['modules/changes/service/proposals.ts'],
} as const
