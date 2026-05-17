/**
 * Per-event-name → array of allowed producer file paths
 * (relative to packages/template/).
 *
 * Adding a producer: append to the matching array.
 * Adding a new event: add to events.ts registry + to a new entry here.
 *
 * Phase 1 (US-004): only `cron`. Slice B will register the 5 new events:
 *   conversation_reassigned, approval_filed, approval_decided,
 *   proposal_filed, proposal_decided.
 */
export const EMIT_REGISTRY: Record<string, readonly string[]> = {
  cron: ['wake/heartbeat.ts'],
} as const
