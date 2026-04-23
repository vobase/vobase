/**
 * Canonical pg-boss queue names owned by the agents module. Re-exported from
 * `jobs.ts` so the module-shape lint sees the `jobs.ts` surface; the names
 * live in their own file so other modules (messaging approval-resume path) can
 * depend on them without pulling job handlers.
 */

export const AGENT_WAKE_JOB = 'agents:agent-wake'
export const SCHEDULED_FOLLOWUP_JOB = 'agents:scheduled-followup'

export type AgentsJobName = typeof AGENT_WAKE_JOB | typeof SCHEDULED_FOLLOWUP_JOB
