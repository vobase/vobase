import type { MiddlewareHandler } from 'hono'
import { cors } from 'hono/cors'

function parseAllowedOrigins(): string[] {
  const raw = process.env.WIDGET_ALLOWED_ORIGINS ?? ''
  return raw
    .split(',')
    .map((o) => o.trim())
    .filter((o) => o.length > 0)
}

/**
 * CORS for cross-origin widget embeds. `credentials: true` forbids `*`, so
 * the allowed origin is reflected back. In dev with no allowlist configured,
 * any origin is reflected; in prod the origin must appear in
 * `WIDGET_ALLOWED_ORIGINS` (comma-separated).
 */
export function createWidgetCors(): MiddlewareHandler {
  const allowedOrigins = parseAllowedOrigins()
  const isDev = process.env.NODE_ENV !== 'production'
  return cors({
    origin: (origin) => {
      if (!origin) return origin
      if (isDev && allowedOrigins.length === 0) return origin
      return allowedOrigins.includes(origin) ? origin : null
    },
    credentials: true,
    allowHeaders: ['content-type', 'authorization', 'x-channel-instance-id', 'x-channel-secret', 'x-hub-signature-256'],
    allowMethods: ['GET', 'POST', 'PUT', 'PATCH', 'DELETE', 'OPTIONS'],
    exposeHeaders: ['content-type'],
  })
}
