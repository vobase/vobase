/**
 * Minimal queue contract for wake scheduling. Production binds this to pg-boss
 * (5 wake triggers, pg-boss singletonKey + startAfter for debouncing). Tests
 * bind it to `createFakeWakeQueue()` below so unit coverage does not require a
 * running postgres pg-boss installation.
 *
 * Two send shapes:
 *   - `send()` — straight enqueue for one-shot triggers (approval_resumed,
 *     supervisor, scheduled_followup, manual).
 *   - `sendOrMerge()` — for inbound_message debouncing. If a pending job with
 *     the same singletonKey exists, its payload is merged via the supplied
 *     `merge()` callback instead of a second job being created. Production
 *     pg-boss implements this via an UPDATE on `pgboss.job` (SELECT FOR UPDATE
 *     on singleton_key, jsonb_set `data`, then commit); the in-memory fake
 *     simulates the same semantics for tests.
 */

export interface SendOpts {
  /**
   * Per-conversation debounce key. pg-boss singleton semantics: at most one
   * pending job per (queue, singletonKey) — further sends during the window
   * are either dropped (send) or merged (sendOrMerge).
   */
  singletonKey?: string
  /** Delay before the job becomes visible to a worker. */
  startAfter?: number | Date
  /** Retry budget for at-least-once delivery semantics. Default: 2. */
  retryLimit?: number
}

export interface Job<T = unknown> {
  id: string
  name: string
  data: T
  /** Attempt count (1-indexed). Used to detect mid-turn restarts. */
  attempt: number
}

export type JobHandler<T = unknown> = (job: Job<T>) => Promise<void>

export interface WakeQueue {
  send<T>(name: string, data: T, opts?: SendOpts): Promise<{ jobId: string | null; wasNew: boolean }>
  sendOrMerge<T>(
    name: string,
    data: T,
    opts: SendOpts & { singletonKey: string },
    merge: (existing: T, incoming: T) => T,
  ): Promise<{ jobId: string; wasNew: boolean }>
  work<T>(name: string, handler: JobHandler<T>): Promise<void>
  stop(): Promise<void>
}

// ---- in-memory fake (tests only) ------------------------------------------

interface FakePendingJob {
  id: string
  name: string
  data: unknown
  singletonKey?: string
  availableAt: number
  attempt: number
}

export interface FakeWakeQueue extends WakeQueue {
  /** Drive queued jobs through their registered workers. */
  drain(): Promise<void>
  /** Fast-forward `startAfter` delays. */
  advance(ms: number): void
  /** Inspect the pending-job list (test assertions). */
  pending(): ReadonlyArray<FakePendingJob>
  /** Count of successfully-completed handler invocations. */
  completedCount(name: string): number
  /** Simulate a mid-turn worker crash: next `drain()` of `name` throws once. */
  failNextOnce(name: string): void
  now(): number
}

export function createFakeWakeQueue(): FakeWakeQueue {
  const pending: FakePendingJob[] = []
  const workers = new Map<string, JobHandler>()
  const completed = new Map<string, number>()
  const failOnce = new Set<string>()
  let clock = 0
  let idCounter = 0

  function nextId(): string {
    idCounter += 1
    return `job-${idCounter}`
  }

  function computeAvailableAt(startAfter: SendOpts['startAfter']): number {
    if (startAfter == null) return clock
    if (startAfter instanceof Date) return startAfter.getTime()
    return clock + startAfter * 1000
  }

  function findPending(name: string, singletonKey: string | undefined): FakePendingJob | undefined {
    if (!singletonKey) return undefined
    return pending.find((j) => j.name === name && j.singletonKey === singletonKey)
  }

  const queue: FakeWakeQueue = {
    async send<T>(name: string, data: T, opts?: SendOpts): Promise<{ jobId: string | null; wasNew: boolean }> {
      if (opts?.singletonKey && findPending(name, opts.singletonKey)) {
        return { jobId: null, wasNew: false }
      }
      const id = nextId()
      pending.push({
        id,
        name,
        data: data as unknown,
        singletonKey: opts?.singletonKey,
        availableAt: computeAvailableAt(opts?.startAfter),
        attempt: 0,
      })
      return { jobId: id, wasNew: true }
    },
    async sendOrMerge<T>(
      name: string,
      data: T,
      opts: SendOpts & { singletonKey: string },
      merge: (existing: T, incoming: T) => T,
    ): Promise<{ jobId: string; wasNew: boolean }> {
      const existing = findPending(name, opts.singletonKey)
      if (existing) {
        existing.data = merge(existing.data as T, data)
        return { jobId: existing.id, wasNew: false }
      }
      const id = nextId()
      pending.push({
        id,
        name,
        data: data as unknown,
        singletonKey: opts.singletonKey,
        availableAt: computeAvailableAt(opts.startAfter),
        attempt: 0,
      })
      return { jobId: id, wasNew: true }
    },
    async work<T>(name: string, handler: JobHandler<T>): Promise<void> {
      workers.set(name, handler as JobHandler)
    },
    async stop(): Promise<void> {
      workers.clear()
    },
    async drain(): Promise<void> {
      for (;;) {
        const idx = pending.findIndex((j) => j.availableAt <= clock && workers.has(j.name))
        if (idx === -1) break
        const job = pending[idx]
        if (!job) break
        const handler = workers.get(job.name)
        if (!handler) break
        job.attempt += 1
        const simulateFail = failOnce.has(job.name) && job.attempt === 1
        if (simulateFail) {
          failOnce.delete(job.name)
          try {
            await handler({ id: job.id, name: job.name, data: job.data, attempt: job.attempt })
          } catch {
            // leave in pending for retry
          }
          // inject synthetic crash: job stays pending for next drain
          continue
        }
        pending.splice(idx, 1)
        try {
          await handler({ id: job.id, name: job.name, data: job.data, attempt: job.attempt })
          completed.set(job.name, (completed.get(job.name) ?? 0) + 1)
        } catch {
          // retry budget: put back once
          if (job.attempt < 3) {
            pending.push(job)
          }
        }
      }
    },
    advance(ms: number): void {
      clock += ms
    },
    pending(): ReadonlyArray<FakePendingJob> {
      return pending.slice()
    },
    completedCount(name: string): number {
      return completed.get(name) ?? 0
    },
    failNextOnce(name: string): void {
      failOnce.add(name)
    },
    now(): number {
      return clock
    },
  }

  return queue
}
