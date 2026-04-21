/**
 * GET /api/sse — fanout from the singleton RealtimeService to each connected
 * browser via Server-Sent Events.
 *
 * Mirrors `@vobase/core`'s app.ts SSE route (v1 pattern):
 *   - No per-session pg connection. The one LISTEN lives inside the
 *     RealtimeService; this route just calls `realtime.subscribe(fn)`.
 *   - `stream.writeSSE` is fire-and-forget inside the subscriber. Awaiting it
 *     inside a notify callback serializes writes and errors the stream on the
 *     second burst (the bug v2 had before this rewrite).
 *   - Keep-alive uses `stream.sleep(25_000)` rather than `setInterval` so the
 *     loop tears down cleanly when the client aborts.
 */
import type { RealtimeService } from '@server/contracts/plugin-context'
import { Hono } from 'hono'
import { streamSSE } from 'hono/streaming'

export function createSseRoute(realtime: RealtimeService): Hono {
  const app = new Hono()

  app.get('/', async (c) => {
    return streamSSE(c, async (stream) => {
      const unsub = realtime.subscribe((payload) => {
        stream.writeSSE({ data: payload, event: 'invalidate' })
      })
      stream.onAbort(unsub)

      // Immediate ping flushes response headers through proxies so the browser's
      // EventSource transitions CONNECTING → OPEN without waiting for a notify.
      await stream.writeSSE({ data: '{}', event: 'connected' })

      while (true) {
        await stream.sleep(25_000)
        await stream.writeSSE({ data: '', event: 'ping' })
      }
    })
  })

  return app
}
