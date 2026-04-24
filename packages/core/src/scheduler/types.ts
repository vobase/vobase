/**
 * Scheduler surface types.
 *
 * `ScopedScheduler` is the contract every module receives at init via
 * `ModuleInitCtx.jobs`; `JobDef` is the declarative shape a module exports so
 * the core boot loop can bind named handlers to the underlying queue. Types
 * only — the pg-boss / in-process implementation lives in the consuming
 * application.
 */

export interface ScheduleOpts {
  startAfter?: Date
  singletonKey?: string
}

export interface ScopedScheduler {
  send(name: string, data: unknown, opts?: ScheduleOpts): Promise<string>
  cancel(jobId: string): Promise<void>
  schedule?(name: string, cron: string, data?: unknown, opts?: ScheduleOpts): Promise<string>
}

/**
 * Declarative job definition exported from a module's `jobs.ts`. `disabled`
 * lets modules ship placeholders that pass typecheck while the underlying
 * worker wiring is still pending.
 */
export interface JobDef {
  name: string
  handler: (data: unknown) => Promise<void>
  disabled?: boolean
}
