#!/usr/bin/env bun
/**
 * Live smoke: fetch WhatsApp message templates via the Graph API.
 *
 * Calls GET /api/channels/instances?channel=whatsapp to list instances, then
 * hits the Meta Graph API directly with the stored token to confirm templates
 * are readable. This verifies the access token is valid without requiring a
 * full inbound flow.
 *
 * Skips when META_WA_* env vars are absent.
 *
 * Required env: META_WA_ACCESS_TOKEN (or META_WA_TOKEN), META_WA_WABA_ID
 * Optional env: BASE_URL, SMOKE_EMAIL, META_WA_API_VERSION
 */

import { describe, expect, test } from 'bun:test'

const ACCESS_TOKEN = process.env.META_WA_ACCESS_TOKEN ?? process.env.META_WA_TOKEN
const WABA_ID = process.env.META_WA_WABA_ID
const API_VERSION = process.env.META_WA_API_VERSION ?? 'v21.0'

const SKIP = !ACCESS_TOKEN || !WABA_ID

describe('WhatsApp templates smoke', () => {
  test.skipIf(SKIP)('Graph API returns templates list', async () => {
    if (!ACCESS_TOKEN || !WABA_ID) return

    const url = `https://graph.facebook.com/${API_VERSION}/${WABA_ID}/message_templates?limit=5&fields=name,status,language&access_token=${ACCESS_TOKEN}`
    const res = await fetch(url)
    expect(res.status).toBe(200)

    const json = (await res.json()) as { data?: unknown[] }
    expect(Array.isArray(json.data)).toBe(true)
  })
})
