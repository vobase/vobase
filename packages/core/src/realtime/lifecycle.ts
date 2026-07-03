/**
 * Subscriber-scoped connection lifecycle for the realtime LISTEN transport.
 *
 * On Neon, a persistent LISTEN connection pins the compute at its CU floor 24/7: autosuspend kills the idle socket, postgres.js's listen sub-client eagerly reconnects to restore the subscription, and the connection attempt itself re-wakes the compute — so cadence tweaks to the keepalive change nothing. The only way to let the compute sleep is for the LISTEN connection to not exist while nothing needs it. This helper refcounts subscribers and opens the underlying connection on 0→1, closing it (after a linger, so page reloads don't churn connections) on 1→0.
 *
 * All open/close transitions are serialized on an internal promise chain, so a subscriber arriving mid-teardown waits for the close before reopening. At most one open attempt or retry is ever in flight: `openNow`/`scheduleRetry`/`retain` all no-op while a retry timer is pending, so concurrent retains during an outage can't fork parallel connection-attempt chains against the (waking) database.
 */

/** Handle over an established LISTEN connection. */
export interface ScopedListenerConn {
  close(): Promise<void>
}

export interface ScopedListenerOpts {
  /** Establish the LISTEN connection. Called on 0→1 subscriber transitions and on retry after a failed open. */
  open(): Promise<ScopedListenerConn>
  /** How long to keep the connection after the last subscriber leaves. Default 60s. */
  lingerMs?: number
  /** First retry delay after a failed open; doubles per attempt. Default 1s. */
  retryBaseMs?: number
  /** Retry delay ceiling. Default 60s. */
  retryMaxMs?: number
  /**
   * Consecutive failed opens after which the listener gives up retrying (until the next 0→1 subscriber epoch).
   * `0` (default) = retry forever, so a real dashboard survives an arbitrarily long DB outage. Set a finite cap
   * on boot-pinned paths (e.g. eager LISTEN) where a permanently bad DSN would otherwise re-wake the compute
   * every `retryMaxMs` for the process lifetime with no real subscriber.
   */
  retryMaxAttempts?: number
  onError?(err: unknown): void
}

export interface ScopedListener {
  /** A subscriber appeared — open the connection if this is the first one. */
  retain(): void
  /** A subscriber left — schedule teardown if it was the last one. */
  release(): void
  /** Settles once the in-flight open/close transition (if any) has completed. Never rejects. */
  ready(): Promise<void>
  /** Tear down permanently; further retains are ignored. */
  shutdown(): Promise<void>
  /** Whether the underlying connection is currently established. */
  isOpen(): boolean
}

export function createScopedListener(opts: ScopedListenerOpts): ScopedListener {
  const lingerMs = opts.lingerMs ?? 60_000
  const retryBaseMs = opts.retryBaseMs ?? 1_000
  const retryMaxMs = opts.retryMaxMs ?? 60_000
  const retryMaxAttempts = opts.retryMaxAttempts ?? 0

  let refs = 0
  let conn: ScopedListenerConn | null = null
  let chain: Promise<void> = Promise.resolve()
  let lingerTimer: ReturnType<typeof setTimeout> | null = null
  let retryTimer: ReturnType<typeof setTimeout> | null = null
  let retryAttempt = 0
  // Latched after `retryMaxAttempts` consecutive failures; reset only by a fresh 0→1 subscriber epoch.
  let gaveUp = false
  let shutdownRequested = false

  function clearLinger(): void {
    if (lingerTimer) {
      clearTimeout(lingerTimer)
      lingerTimer = null
    }
  }

  function clearRetry(): void {
    if (retryTimer) {
      clearTimeout(retryTimer)
      retryTimer = null
    }
  }

  /** Ops never reject — failures route to onError — so the chain never poisons. */
  function enqueue(op: () => Promise<void>): Promise<void> {
    chain = chain.then(op)
    return chain
  }

  function scheduleRetry(): void {
    // A retry already pending, or we've given up — never fork a second chain.
    if (shutdownRequested || retryTimer || gaveUp) return
    if (retryMaxAttempts > 0 && retryAttempt >= retryMaxAttempts) {
      gaveUp = true
      opts.onError?.(new Error(`[realtime] giving up LISTEN open after ${retryAttempt} consecutive failures`))
      return
    }
    const delay = Math.min(retryBaseMs * 2 ** retryAttempt, retryMaxMs)
    retryAttempt += 1
    retryTimer = setTimeout(() => {
      retryTimer = null
      if (refs > 0 && !conn) void openNow()
    }, delay)
    retryTimer.unref?.()
  }

  function openNow(): Promise<void> {
    return enqueue(async () => {
      // Skip when a retry is pending (its timer owns the next attempt) or we've given up.
      if (shutdownRequested || refs === 0 || conn || retryTimer || gaveUp) return
      try {
        conn = await opts.open()
        retryAttempt = 0
      } catch (err) {
        opts.onError?.(err)
        scheduleRetry()
      }
    })
  }

  function closeNow(): Promise<void> {
    return enqueue(async () => {
      if (!conn || refs > 0) return
      const closing = conn
      conn = null
      try {
        await closing.close()
      } catch (err) {
        opts.onError?.(err)
      }
    })
  }

  return {
    retain(): void {
      if (shutdownRequested) return
      // Fresh epoch — clear any backoff/give-up latched by the previous one.
      if (refs === 0) {
        retryAttempt = 0
        gaveUp = false
      }
      refs += 1
      clearLinger()
      if (!conn && !retryTimer && !gaveUp) void openNow()
    },

    release(): void {
      refs = Math.max(0, refs - 1)
      if (refs > 0) return
      clearRetry()
      clearLinger()
      lingerTimer = setTimeout(() => {
        lingerTimer = null
        if (refs === 0) void closeNow()
      }, lingerMs)
      lingerTimer.unref?.()
    },

    ready(): Promise<void> {
      return chain
    },

    async shutdown(): Promise<void> {
      shutdownRequested = true
      refs = 0
      clearLinger()
      clearRetry()
      await enqueue(async () => {
        if (!conn) return
        const closing = conn
        conn = null
        try {
          await closing.close()
        } catch (err) {
          opts.onError?.(err)
        }
      })
    },

    isOpen(): boolean {
      return conn !== null
    },
  }
}
