#!/usr/bin/env bun
/**
 * Live smoke: POST a WhatsApp inbound message webhook to a running dev server.
 *
 * Skips gracefully when META_WA_* env vars are absent so CI never blocks on
 * missing credentials.
 *
 * Required env:
 *   META_WA_APP_SECRET       — used to sign the HMAC payload
 *   META_WA_PHONE_NUMBER_ID  — must match an existing channel_instance config
 *   WA_INSTANCE_ID           — channel_instances.id for the target instance
 *
 * Optional env:
 *   BASE_URL   — default http://localhost:3000
 *   SMOKE_EMAIL — staff account for dev-login; default smoke@example.com
 */

import { createHmac } from 'node:crypto'
import { describe, expect, test } from 'bun:test'

import { devLogin, makeAuthedFetch } from './_helpers'

const APP_SECRET = process.env.META_WA_APP_SECRET
const PHONE_NUMBER_ID = process.env.META_WA_PHONE_NUMBER_ID
const INSTANCE_ID = process.env.WA_INSTANCE_ID
const BASE = process.env.BASE_URL ?? 'http://localhost:3000'
const SMOKE_EMAIL = process.env.SMOKE_EMAIL ?? 'smoke@example.com'

const SKIP = !APP_SECRET || !PHONE_NUMBER_ID || !INSTANCE_ID

function waBody(phoneNumberId: string) {
  const waId = `1650${Date.now()}`
  return JSON.stringify({
    object: 'whatsapp_business_account',
    entry: [
      {
        id: 'waba-smoke',
        changes: [
          {
            value: {
              messaging_product: 'whatsapp',
              metadata: { display_phone_number: '15550000001', phone_number_id: phoneNumberId },
              contacts: [{ profile: { name: 'Smoke Caller' }, wa_id: waId }],
              messages: [
                {
                  from: waId,
                  id: `wamid.smoke${Date.now()}`,
                  timestamp: String(Math.floor(Date.now() / 1000)),
                  text: { body: 'Hello from smoke test' },
                  type: 'text',
                },
              ],
            },
            field: 'messages',
          },
        ],
      },
    ],
  })
}

function sign(body: string, secret: string) {
  return `sha256=${createHmac('sha256', secret).update(body).digest('hex')}`
}

describe('WhatsApp inbound smoke', () => {
  test.skipIf(SKIP)('webhook accepted and queued', async () => {
    if (!APP_SECRET || !PHONE_NUMBER_ID || !INSTANCE_ID) return
    const auth = await devLogin(BASE, SMOKE_EMAIL)
    const fetch = makeAuthedFetch(BASE, auth)

    const body = waBody(PHONE_NUMBER_ID)
    const sig = sign(body, APP_SECRET)

    const res = await fetch(`/api/channels/webhooks/whatsapp/${INSTANCE_ID}`, {
      method: 'POST',
      headers: { 'content-type': 'application/json', 'x-hub-signature-256': sig },
      body,
    })

    expect(res.status).toBe(200)
    const json = (await res.json()) as { ok?: boolean }
    expect(json.ok).toBe(true)
  })
})
