#!/usr/bin/env bun
/**
 * Smoke test — σ5 gate for SV-REPLY: POST /api/inbox/conversations/:id/reply
 * against a seeded conversation; asserts 2xx + messageId in body + SSE NOTIFY
 * received within 2s.
 *
 * Usage: BASE_URL=http://localhost:3001 CONV_ID=conv_seed_1 bun run scripts/smoke-staff-reply.ts
 */

const BASE_URL = process.env.BASE_URL ?? 'http://localhost:3001'
const ORG_ID = process.env.ORG_ID ?? 'mer0tenant'
const CONV_ID = process.env.CONV_ID ?? 'conv_seed_1'
const SSE_URL = process.env.SSE_URL ?? `${BASE_URL}/sse?organizationId=${ORG_ID}`
const API = `${BASE_URL}/api/inbox/conversations/${CONV_ID}`

function sseNotifyPromise(): { promise: Promise<void>; abort: AbortController } {
  const ctrl = new AbortController()
  const promise = new Promise<void>((resolve, reject) => {
    fetch(SSE_URL, { signal: ctrl.signal })
      .then(async (res) => {
        const reader = res.body?.getReader()
        if (!reader) return reject(new Error('no SSE body'))
        const dec = new TextDecoder()
        while (true) {
          const { done, value } = await reader.read()
          if (done) break
          const chunk = dec.decode(value)
          if (chunk.includes('conversations') && chunk.includes(CONV_ID)) {
            resolve()
            break
          }
        }
      })
      .catch((e) => {
        if (e.name !== 'AbortError') reject(e)
      })
  })
  return { promise, abort: ctrl }
}

async function main() {
  console.log(`[smoke:staff-reply] target: ${BASE_URL}  conv: ${CONV_ID}`)

  // Subscribe to SSE before posting so we don't miss the NOTIFY
  const { promise: sseP, abort } = sseNotifyPromise()
  const timeout = new Promise<never>((_, reject) => setTimeout(() => reject(new Error('SSE timeout (2s)')), 2000))

  const res = await fetch(`${API}/reply?organizationId=${ORG_ID}`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ body: 'smoke-test staff reply', staffUserId: 'staff_smoke' }),
  })

  if (res.status < 200 || res.status >= 300) {
    abort.abort()
    console.error(`[smoke:staff-reply] ✗ POST /reply returned ${res.status}: ${await res.text()}`)
    process.exit(1)
  }

  const data = (await res.json()) as Record<string, unknown>
  if (typeof data.messageId !== 'string') {
    abort.abort()
    console.error(`[smoke:staff-reply] ✗ Response missing messageId: ${JSON.stringify(data)}`)
    process.exit(1)
  }

  console.log(`[smoke:staff-reply] ✓ POST /reply → ${res.status}, messageId: ${data.messageId}`)

  try {
    await Promise.race([sseP, timeout])
    abort.abort()
    console.log('[smoke:staff-reply] ✓ SSE NOTIFY received within 2s')
  } catch (e) {
    abort.abort()
    console.error(`[smoke:staff-reply] ✗ ${(e as Error).message}`)
    process.exit(1)
  }

  console.log('[smoke:staff-reply] all assertions passed')
}

await main()

export {}
