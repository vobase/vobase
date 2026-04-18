/**
 * agents module job registry — see `service/queue-jobs.ts` for names and
 * `service/wake-worker.ts` for consumers.
 *
 * The `jobs` export stays a tuple because it satisfies the module-shape lint
 * (`jobs.ts` must export `jobs`); actual pg-boss work binding happens in the
 * app bootstrap via `createWakeWorker(...).start()`.
 */

export type { AgentsJobName } from './service/queue-jobs'
export { AGENT_WAKE_JOB, SCHEDULED_FOLLOWUP_JOB } from './service/queue-jobs'

export const jobs = [{ name: 'agents:agent-wake' }, { name: 'agents:scheduled-followup' }] as const
