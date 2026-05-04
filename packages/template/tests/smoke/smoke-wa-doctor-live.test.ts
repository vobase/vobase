#!/usr/bin/env bun
/**
 * Live smoke: run the channel doctor against a WhatsApp instance.
 *
 * Calls POST /api/channels/instances/:id/doctor and asserts we get back a
 * DoctorResult with 5 checks. Does NOT assert all-green — a real instance in
 * dev may have amber checks.
 *
 * Skips when WA_INSTANCE_ID is absent (META_WA_* not required for the HTTP
 * call since the doctor uses the stored config).
 *
 * Required env: WA_INSTANCE_ID
 * Optional env: BASE_URL, SMOKE_EMAIL
 */

import { describe, expect, test } from 'bun:test'

import { devLogin, makeAuthedFetch } from './_helpers'

const INSTANCE_ID = process.env.WA_INSTANCE_ID
const BASE = process.env.BASE_URL ?? 'http://localhost:3000'
const SMOKE_EMAIL = process.env.SMOKE_EMAIL ?? 'smoke@example.com'

const SKIP = !INSTANCE_ID

describe('WhatsApp doctor smoke', () => {
  test.skipIf(SKIP)('doctor returns 5 checks', async () => {
    if (!INSTANCE_ID) return
    const auth = await devLogin(BASE, SMOKE_EMAIL)
    const apiFetch = makeAuthedFetch(BASE, auth)

    const res = await apiFetch(`/api/channels/instances/${INSTANCE_ID}/doctor`, { method: 'POST' })
    expect(res.status).toBe(200)

    const json = (await res.json()) as { instanceId?: string; checks?: unknown[] }
    expect(json.instanceId).toBe(INSTANCE_ID)
    expect(Array.isArray(json.checks)).toBe(true)
    expect(json.checks?.length).toBe(5)
  })
})
