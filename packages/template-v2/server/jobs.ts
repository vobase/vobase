/**
 * In-process job queue — runs handlers via `Promise.resolve()` (or
 * `setTimeout` when `startAfter` is in the future).
 *
 * Satisfies the `ScopedScheduler` contract that modules expect from
 * `ctx.jobs`. Fire-and-forget: the caller's request isn't blocked by the
 * whole handler. Swap for pg-boss if/when multi-process or retry-safe
 * delivery is needed.
 */

import type { ScheduleOpts } from '@vobase/core'
import { nanoid } from 'nanoid'

interface PendingJob {
  timer: ReturnType<typeof setTimeout> | null
  singletonKey?: string
}

export function buildJobQueue(handlers: Map<string, (data: unknown) => Promise<void>>) {
  const pending = new Map<string, PendingJob>()
  const bySingleton = new Map<string, string>()

  function dispatch(name: string, data: unknown, jobId: string): void {
    const handler = handlers.get(name)
    if (!handler) {
      console.warn(`[jobs] no handler registered for "${name}"; dropping`)
      pending.delete(jobId)
      return
    }
    console.log(`[jobs] dispatching "${name}" (${jobId})`)
    void handler(data)
      .then(() => console.log(`[jobs] "${name}" (${jobId}) complete`))
      .catch((err) => {
        console.error(`[jobs] handler "${name}" failed:`, err)
      })
      .finally(() => {
        const job = pending.get(jobId)
        if (job?.singletonKey && bySingleton.get(job.singletonKey) === jobId) {
          bySingleton.delete(job.singletonKey)
        }
        pending.delete(jobId)
      })
  }

  return {
    // biome-ignore lint/suspicious/useAwait: contract requires async signature
    async send(name: string, data: unknown, opts?: ScheduleOpts): Promise<string> {
      const jobId = `job-${nanoid(8)}`

      if (opts?.singletonKey) {
        const existingId = bySingleton.get(opts.singletonKey)
        if (existingId) {
          const existing = pending.get(existingId)
          if (existing?.timer) clearTimeout(existing.timer)
          pending.delete(existingId)
        }
        bySingleton.set(opts.singletonKey, jobId)
      }

      const delay = opts?.startAfter ? Math.max(0, opts.startAfter.getTime() - Date.now()) : 0
      if (delay === 0) {
        pending.set(jobId, { timer: null, singletonKey: opts?.singletonKey })
        dispatch(name, data, jobId)
      } else {
        const timer = setTimeout(() => dispatch(name, data, jobId), delay)
        pending.set(jobId, { timer, singletonKey: opts?.singletonKey })
      }
      return jobId
    },
    // biome-ignore lint/suspicious/useAwait: contract requires async signature
    async cancel(jobId: string): Promise<void> {
      const job = pending.get(jobId)
      if (!job) return
      if (job.timer) clearTimeout(job.timer)
      if (job.singletonKey && bySingleton.get(job.singletonKey) === jobId) {
        bySingleton.delete(job.singletonKey)
      }
      pending.delete(jobId)
    },
  }
}
