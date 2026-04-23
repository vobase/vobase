/**
 * Namespace-enforced wrapper around a raw pg-boss-shaped scheduler.
 *
 * Modules declare `manifest.queues: ['snooze']`; the runtime wraps the raw
 * scheduler with `buildScopedScheduler(raw, { moduleName, allowedQueues })`
 * so `ctx.jobs.send('snooze', ...)` works but `ctx.jobs.send('other', ...)`
 * throws `NamespaceViolationError`. Modules that do NOT declare queues pass
 * through unchanged — opt-in during Phase 0 migration window.
 */

import type { ScheduleOpts, ScopedScheduler } from '@server/common/port-types'
import { NamespaceViolationError } from './validate-manifests'

export interface ScopedSchedulerInput {
  moduleName: string
  /** Allowed queue suffixes from `manifest.queues`; undefined = no enforcement. */
  allowedQueues?: readonly string[]
  raw: ScopedScheduler
}

/** Wraps `raw` with namespace enforcement if `allowedQueues` is declared; otherwise passes through. */
export function buildScopedScheduler(input: ScopedSchedulerInput): ScopedScheduler {
  if (input.allowedQueues === undefined) return input.raw
  const allowed = new Set(input.allowedQueues)
  const { moduleName, raw } = input

  const enforce = (name: string): void => {
    if (!allowed.has(name)) {
      throw new NamespaceViolationError(
        moduleName,
        'queue',
        name,
        `queue "${name}" not in manifest.queues [${[...allowed].join(', ')}]`,
      )
    }
  }

  return {
    async send(name: string, data: unknown, opts?: ScheduleOpts): Promise<string> {
      enforce(name)
      return raw.send(name, data, opts)
    },
    async cancel(jobId: string): Promise<void> {
      return raw.cancel(jobId)
    },
    async schedule(name: string, cron: string, data?: unknown, opts?: ScheduleOpts): Promise<string> {
      enforce(name)
      if (!raw.schedule) {
        throw new Error(`scheduler has no schedule() method (module "${moduleName}")`)
      }
      return raw.schedule(name, cron, data, opts)
    },
  }
}
