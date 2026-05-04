#!/usr/bin/env bun
/**
 * Live smoke: POST a WhatsApp SMB echo (coexistence mirror) webhook.
 *
 * Echoes carry `system.type = "smb_message_echoes"` and must be accepted (200)
 * but must NOT enqueue an agent wake. We verify the response is accepted; deep
 * DB assertions are out of scope for a smoke test.
 *
 * Skips when META_WA_* env vars are absent.
 *
 * Required env: META_WA_APP_SECRET, META_WA_PHONE_NUMBER_ID, WA_INSTANCE_ID
 * Optional env: BASE_URL, SMOKE_EMAIL
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

function echoBody(phoneNumberId: string) {
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
              messages: [
                {
                  from: '15559990001',
                  id: `wamid.echo${Date.now()}`,
                  timestamp: String(Math.floor(Date.now() / 1000)),
                  system: { type: 'smb_message_echoes', body: 'Staff reply via phone', wa_id: '15559990001' },
                  type: 'system',
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

describe('WhatsApp echo smoke', () => {
  test.skipIf(SKIP)('echo webhook accepted (no wake enqueued)', async () => {
    if (!APP_SECRET || !PHONE_NUMBER_ID || !INSTANCE_ID) return
    const auth = await devLogin(BASE, SMOKE_EMAIL)
    const apiFetch = makeAuthedFetch(BASE, auth)

    const body = echoBody(PHONE_NUMBER_ID)
    const sig = sign(body, APP_SECRET)

    const res = await apiFetch(`/api/channels/webhooks/whatsapp/${INSTANCE_ID}`, {
      method: 'POST',
      headers: { 'content-type': 'application/json', 'x-hub-signature-256': sig },
      body,
    })

    expect(res.status).toBe(200)
    const json = (await res.json()) as { ok?: boolean }
    expect(json.ok).toBe(true)
  })
})
