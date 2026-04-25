/**
 * GET /api/channel-whatsapp/webhook — Meta hub challenge verification.
 */
import type { Context } from 'hono'

import { requireVerifyToken } from '../service/state'

export function handleWebhookVerify(c: Context): Response {
  const mode = c.req.query('hub.mode')
  const token = c.req.query('hub.verify_token')
  const challenge = c.req.query('hub.challenge')

  if (mode === 'subscribe' && token === requireVerifyToken()) {
    return c.text(challenge ?? '', 200)
  }

  return c.json({ error: 'verification failed' }, 403)
}
