/**
 * GET /api/sse — pg LISTEN fanout over Server-Sent Events.
 *
 * Connects a dedicated postgres client per SSE session, LISTENs on
 * `vobase_sse`, and forwards each NOTIFY payload as an `invalidate` event so
 * `use-realtime-invalidation.ts` can call `queryClient.invalidateQueries`.
 *
 * The connection is cleaned up when the client disconnects (AbortSignal abort).
 */
import { Hono } from 'hono'
import { streamSSE } from 'hono/streaming'
import postgres from 'postgres'
import config from '../../vobase.config'

const app = new Hono()

app.get('/', async (c) => {
  return streamSSE(c, async (stream) => {
    const sql = postgres(config.database, { max: 1 })

    const { unlisten } = await sql.listen('vobase_sse', async (payload) => {
      try {
        await stream.writeSSE({ data: payload, event: 'invalidate' })
      } catch {
        // client disconnected — cleanup handled in finally
      }
    })

    // Send initial ping so the client knows it's connected
    await stream.writeSSE({ data: '{}', event: 'connected' })

    await new Promise<void>((resolve) => {
      if (c.req.raw.signal.aborted) {
        resolve()
        return
      }
      c.req.raw.signal.addEventListener('abort', () => resolve(), { once: true })
      // keepalive ping every 20s
      const timer = setInterval(async () => {
        try {
          await stream.writeSSE({ data: '', event: 'ping' })
        } catch {
          clearInterval(timer)
          resolve()
        }
      }, 20_000)
      stream.onAbort(() => {
        clearInterval(timer)
        resolve()
      })
    })

    await unlisten()
    await sql.end({ timeout: 2 })
  })
})

export default app
