/**
 * In-process job queue — runs handlers synchronously via `Promise.resolve()`.
 *
 * Satisfies the `ScopedScheduler` contract that modules expect from
 * `ctx.jobs`. Fire-and-forget: the caller's request isn't blocked by the
 * whole handler. Swap for pg-boss if/when multi-process or retry-safe
 * delivery is needed.
 */

import { nanoid } from 'nanoid'

export function buildJobQueue(handlers: Map<string, (data: unknown) => Promise<void>>) {
  return {
    async send(name: string, data: unknown): Promise<string> {
      const handler = handlers.get(name)
      const jobId = `job-${nanoid(8)}`
      if (!handler) {
        console.warn(`[jobs] no handler registered for "${name}"; dropping`)
        return jobId
      }
      console.log(`[jobs] dispatching "${name}" (${jobId})`)
      void handler(data)
        .then(() => console.log(`[jobs] "${name}" (${jobId}) complete`))
        .catch((err) => {
          console.error(`[jobs] handler "${name}" failed:`, err)
        })
      return jobId
    },
    async cancel(_jobId: string): Promise<void> {
      // Dev queue is fire-and-forget; cancel is a no-op.
    },
  }
}
