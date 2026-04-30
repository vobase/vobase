#!/usr/bin/env bun

/**
 * Smoke test — POST /notes + /reassign against a seeded conversation;
 * asserts 200 + SSE NOTIFY received within 5s for the note write.
 *
 * Auth is dev-login (Alice). `cnv0test00` is the empty baseline conversation
 * — using it keeps the rich Priya/Marcus/Elena/etc. scenario timelines clean.
 *
 * Usage: BASE_URL=http://localhost:3000 CONV_ID=cnv0test00 bun run tests/smoke/smoke-messaging-mutations.ts
 */

import { devLogin, makeAuthedFetch, watchSse } from './_helpers'

const BASE_URL = process.env.BASE_URL ?? 'http://localhost:3000'
const CONV_ID = process.env.CONV_ID ?? 'cnv0test00'
const EMAIL = process.env.SMOKE_EMAIL ?? 'alice@meridian.test'
const SSE_TIMEOUT_MS = Number(process.env.SSE_TIMEOUT_MS ?? 5000)

async function main() {
  console.log(`[smoke:mutations] target: ${BASE_URL}  conv: ${CONV_ID}`)

  const auth = await devLogin(BASE_URL, EMAIL)
  const api = makeAuthedFetch(BASE_URL, auth)
  const post = (path: string, body: unknown) => api(path, { method: 'POST', body: JSON.stringify(body) })

  const sse = watchSse(BASE_URL, auth.cookie, CONV_ID)
  const timeout = new Promise<never>((_, reject) =>
    setTimeout(() => reject(new Error(`SSE timeout (${SSE_TIMEOUT_MS}ms)`)), SSE_TIMEOUT_MS),
  )

  const notes = await post(`/api/messaging/conversations/${CONV_ID}/notes`, {
    body: 'smoke test note',
    authorType: 'staff',
    authorId: auth.userId,
  })
  if (notes.status !== 200) {
    sse.abort()
    console.error(`[smoke:mutations] ✗ POST /notes ${notes.status}: ${await notes.text()}`)
    process.exit(1)
  }
  console.log('[smoke:mutations] ✓ POST /notes → 200')

  try {
    await Promise.race([sse.promise, timeout])
    console.log('[smoke:mutations] ✓ SSE NOTIFY received')
  } catch (e) {
    console.error(`[smoke:mutations] ✗ ${(e as Error).message}`)
    process.exit(1)
  } finally {
    sse.abort()
  }

  // Reassign back to the agent so re-running the smoke is idempotent
  // (cnv0test00 is seeded with `agent:agt0mer0v1` as the initial assignee).
  const reassign = await post(`/api/messaging/conversations/${CONV_ID}/reassign`, {
    assignee: 'agent:agt0mer0v1',
    by: auth.userId,
    note: 'smoke-test reassign',
  })
  if (reassign.status !== 200) {
    console.error(`[smoke:mutations] ✗ POST /reassign ${reassign.status}: ${await reassign.text()}`)
    process.exit(1)
  }
  console.log('[smoke:mutations] ✓ POST /reassign → 200')
  console.log('[smoke:mutations] all assertions passed')
}

await main()
