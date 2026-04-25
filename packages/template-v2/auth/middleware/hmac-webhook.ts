import { verifyHmacSignature } from '@vobase/core'
import type { Context } from 'hono'

import { parseHubSignature } from './hub-signature'

export interface HmacWebhookOptions {
  /** Resolve the secret for this request (header override, env, DB). Return null for "not configured". */
  secret: (c: Context) => string | null | undefined
  /** When no secret is configured AND no signature header is present, allow the request in non-production. */
  devBypass?: boolean
}

export type HmacWebhookResult = { ok: true; rawBody: string; payload: unknown } | { ok: false; response: Response }

/**
 * Verify `X-Hub-Signature-256` HMAC + parse JSON body. Exposed as a helper
 * (not middleware) so handlers called with a mock context in unit tests don't
 * need a full Hono app.
 */
export async function verifyHmacWebhook(c: Context, opts: HmacWebhookOptions): Promise<HmacWebhookResult> {
  const rawBody = await c.req.text()
  const sigHeader = c.req.header('x-hub-signature-256')
  const secret = opts.secret(c) ?? null

  if (!sigHeader) {
    const secretConfigured = !!secret
    if (secretConfigured || process.env.NODE_ENV === 'production' || !opts.devBypass) {
      return { ok: false, response: c.json({ error: 'missing x-hub-signature-256' }, 403) }
    }
    console.warn('[hmac-webhook] accepting unsigned request — secret not configured (dev only)')
  } else {
    if (!secret) {
      return { ok: false, response: c.json({ error: 'webhook secret not configured' }, 500) }
    }
    const sig = parseHubSignature(c)
    if (!verifyHmacSignature(rawBody, sig, secret)) {
      return { ok: false, response: c.json({ error: 'invalid signature' }, 401) }
    }
  }

  let payload: unknown
  try {
    payload = JSON.parse(rawBody)
  } catch {
    return { ok: false, response: c.json({ error: 'invalid json' }, 400) }
  }

  return { ok: true, rawBody, payload }
}
