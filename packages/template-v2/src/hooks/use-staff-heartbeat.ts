import { useEffect } from 'react'

const DEFAULT_INTERVAL_MS = 60_000

/**
 * Pings `POST /api/team/heartbeat` every 60s while the document is visible, so
 * the server can track `staff_profiles.last_seen_at`. Consumed by T7b offline
 * detection (notification fan-out to WhatsApp when a mention lands for an
 * offline staff member).
 */
export function useStaffHeartbeat(intervalMs: number = DEFAULT_INTERVAL_MS): void {
  useEffect(() => {
    let cancelled = false
    const ping = () => {
      if (cancelled) return
      if (typeof document !== 'undefined' && document.visibilityState !== 'visible') return
      // biome-ignore lint/plugin/no-raw-fetch: fire-and-forget heartbeat ping — no response inspection, no caching, intentionally bypasses the typed-RPC client
      void fetch('/api/team/heartbeat', { method: 'POST' }).catch(() => undefined)
    }
    ping()
    const id = window.setInterval(ping, intervalMs)
    const onVisible = () => {
      if (document.visibilityState === 'visible') ping()
    }
    document.addEventListener('visibilitychange', onVisible)
    return () => {
      cancelled = true
      window.clearInterval(id)
      document.removeEventListener('visibilitychange', onVisible)
    }
  }, [intervalMs])
}
