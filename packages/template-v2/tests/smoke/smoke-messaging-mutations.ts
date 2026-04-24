#!/usr/bin/env bun
/**
 * Smoke test — per C3: POST /notes + /reassign against a seeded conversation;
 * asserts 200 + SSE NOTIFY received within 2s.
 * Run on integration/template-v2-pr1 BEFORE σ5 stub-flag removal.
 *
 * Usage: BASE_URL=http://localhost:3001 CONV_ID=conv_seed_1 bun run tests/smoke/smoke-messaging-mutations.ts
 */

const BASE_URL = process.env.BASE_URL ?? 'http://localhost:3001'
const ORG_ID = process.env.ORG_ID ?? 'tenant_meridian'
const CONV_ID = process.env.CONV_ID ?? 'conv_seed_1'
const SSE_URL = process.env.SSE_URL ?? `${BASE_URL}/sse?organizationId=${ORG_ID}`
const API = `${BASE_URL}/api/messaging/conversations/${CONV_ID}`

function sse2sPromise(): { promise: Promise<void>; abort: AbortController } {
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

async function post(path: string, body: unknown) {
  const res = await fetch(`${API}${path}?organizationId=${ORG_ID}`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  })
  return res
}

async function main() {
  console.log(`[smoke] target: ${BASE_URL}  conv: ${CONV_ID}`)

  const { promise: sseP, abort } = sse2sPromise()
  const timeout = new Promise<never>((_, reject) => setTimeout(() => reject(new Error('SSE timeout (2s)')), 2000))

  const notes = await post('/notes', { body: 'smoke test note', authorType: 'staff', authorId: 'staff_smoke' })
  if (notes.status !== 200) {
    console.error(`[smoke] ✗ POST /notes returned ${notes.status}: ${await notes.text()}`)
    process.exit(1)
  }
  console.log('[smoke] ✓ POST /notes → 200')

  try {
    await Promise.race([sseP, timeout])
    abort.abort()
    console.log('[smoke] ✓ SSE NOTIFY received within 2s')
  } catch (e) {
    abort.abort()
    console.error(`[smoke] ✗ ${(e as Error).message}`)
    process.exit(1)
  }

  const reassign = await post('/reassign', { assignee: 'staff_smoke' })
  if (reassign.status !== 200) {
    console.error(`[smoke] ✗ POST /reassign returned ${reassign.status}: ${await reassign.text()}`)
    process.exit(1)
  }
  console.log('[smoke] ✓ POST /reassign → 200')
  console.log('[smoke] all assertions passed')
}

await main()

export {}
