#!/usr/bin/env bun

/**
 * Smoke test — POST /api/messaging/conversations/:id/reply against a seeded
 * conversation; asserts 2xx + messageId in body + SSE NOTIFY received within 5s.
 *
 * Auth is dev-login (Alice) — the route is gated by `requireSession`. The
 * seeded conversation `cnv0test00` (SEEDED_CONV_ID) is intentionally empty so
 * smoke runs don't pollute scenario-rich threads.
 *
 * Usage: BASE_URL=http://localhost:3000 CONV_ID=cnv0test00 bun run tests/smoke/smoke-staff-reply.ts
 */

import { devLogin, makeAuthedFetch, watchSse } from './_helpers'

const BASE_URL = process.env.BASE_URL ?? 'http://localhost:3000'
const CONV_ID = process.env.CONV_ID ?? 'cnv0test00'
const EMAIL = process.env.SMOKE_EMAIL ?? 'alice@meridian.test'
const SSE_TIMEOUT_MS = Number(process.env.SSE_TIMEOUT_MS ?? 5000)

async function main() {
  console.log(`[smoke:staff-reply] target: ${BASE_URL}  conv: ${CONV_ID}`)

  const auth = await devLogin(BASE_URL, EMAIL)
  const api = makeAuthedFetch(BASE_URL, auth)

  // Subscribe to SSE before posting so we can't miss the NOTIFY.
  const sse = watchSse(BASE_URL, auth.cookie, CONV_ID)
  const timeout = new Promise<never>((_, reject) =>
    setTimeout(() => reject(new Error(`SSE timeout (${SSE_TIMEOUT_MS}ms)`)), SSE_TIMEOUT_MS),
  )

  const res = await api(`/api/messaging/conversations/${CONV_ID}/reply`, {
    method: 'POST',
    body: JSON.stringify({ body: 'smoke-test staff reply' }),
  })

  if (res.status < 200 || res.status >= 300) {
    sse.abort()
    console.error(`[smoke:staff-reply] ✗ POST /reply ${res.status}: ${await res.text()}`)
    process.exit(1)
  }

  const data = (await res.json()) as Record<string, unknown>
  if (typeof data.messageId !== 'string') {
    sse.abort()
    console.error(`[smoke:staff-reply] ✗ response missing messageId: ${JSON.stringify(data)}`)
    process.exit(1)
  }

  console.log(`[smoke:staff-reply] ✓ POST /reply → ${res.status}, messageId: ${data.messageId}`)

  try {
    await Promise.race([sse.promise, timeout])
    console.log('[smoke:staff-reply] ✓ SSE NOTIFY received')
  } catch (e) {
    console.error(`[smoke:staff-reply] ✗ ${(e as Error).message}`)
    process.exit(1)
  } finally {
    sse.abort()
  }

  console.log('[smoke:staff-reply] all assertions passed')
}

await main()
