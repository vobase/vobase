#!/usr/bin/env bun

/**
 * Live smoke for the operator_thread wake path. Posts a fresh staff message
 * to the seeded `thd0smoke01` thread (Sentinel) and polls the agent_messages
 * journal for an assistant turn keyed by the synthetic conversationId
 * `operator-thd0smoke01`.
 *
 * Requires:
 *   - dev server on :3000 (`bun run dev:server`)
 *   - OPENAI_API_KEY (or BIFROST) so the harness can actually drive the model
 *
 * Usage: BASE_URL=http://localhost:3000 bun run tests/smoke/smoke-operator-thread-live.ts
 */

import { devLogin, makeAuthedFetch } from './_helpers'

const BASE_URL = process.env.BASE_URL ?? 'http://localhost:3000'
const ORG_ID = process.env.ORG_ID ?? 'mer0tenant'
const THREAD_ID = process.env.THREAD_ID ?? 'thd0smoke01'
const EMAIL = process.env.SMOKE_EMAIL ?? 'alice@meridian.test'
const POLL_S = Number(process.env.POLL_S ?? 90)
const PROMPT =
  process.env.PROMPT ??
  `Smoke test ${new Date().toISOString()} — quick brief: how many active conversations are open right now, and which one is oldest?`

const SYNTH_CONV_ID = `operator-${THREAD_ID}`

async function main() {
  console.log(`[smoke:op-thread] target=${BASE_URL} thread=${THREAD_ID} conv=${SYNTH_CONV_ID}`)

  const auth = await devLogin(BASE_URL, EMAIL)
  const api = makeAuthedFetch(BASE_URL, auth)

  // biome-ignore lint/plugin/no-dynamic-import: heavy optional dep
  const postgres = (await import('postgres')).default
  const sql = postgres(process.env.DATABASE_URL ?? 'postgres://vobase:vobase@localhost:5432/vobase')
  try {
    // Snapshot the journal turn count BEFORE so reruns don't false-positive
    // off a previous smoke's reply. Synthetic conversationIds are stable.
    const baseline = await sql<{ count: number }[]>`
      SELECT count(*)::int FROM harness.messages m
      JOIN harness.threads t ON t.id = m.thread_id
      WHERE t.conversation_id = ${SYNTH_CONV_ID}
        AND m.payload->>'role' = 'assistant'
    `
    const baseAssistantCount = baseline[0]?.count ?? 0
    console.log(`[smoke:op-thread] baseline assistant turns=${baseAssistantCount}`)

    const postRes = await api(`/api/agents/threads/${THREAD_ID}/messages`, {
      method: 'POST',
      body: JSON.stringify({ organizationId: ORG_ID, content: PROMPT }),
    })
    const postBody = await postRes.text()
    if (!postRes.ok) {
      console.error(`[smoke:op-thread] ✗ POST messages ${postRes.status}: ${postBody}`)
      process.exit(1)
    }
    console.log(`[smoke:op-thread] ✓ POST messages ${postRes.status}: ${postBody}`)

    for (let i = 0; i < POLL_S; i += 1) {
      await new Promise((r) => setTimeout(r, 1000))
      const rows = await sql<{ id: string; seq: number; payload: unknown }[]>`
        SELECT m.id, m.seq, m.payload
        FROM harness.messages m
        JOIN harness.threads t ON t.id = m.thread_id
        WHERE t.conversation_id = ${SYNTH_CONV_ID}
          AND m.payload->>'role' = 'assistant'
        ORDER BY m.seq ASC
      `
      if (rows.length > baseAssistantCount) {
        const latest = rows[rows.length - 1]
        if (!latest) {
          console.error('[smoke:op-thread] ✗ unexpected: count grew but no row')
          process.exit(1)
        }
        const text = pickText(latest.payload)
        console.log('\n✅ standalone-lane operator_thread wake produced an assistant turn:')
        console.log(`  id=${latest.id} seq=${latest.seq}`)
        console.log(`  text=${text ?? '(non-text payload — see payload field)'}`)
        process.exit(0)
      }
      if (i % 5 === 0) console.log(`[poll ${i}s] assistant turns so far: ${rows.length}`)
    }
    console.error('❌ timed out waiting for operator_thread assistant turn')
    process.exit(2)
  } finally {
    await sql.end()
  }
}

function pickText(payload: unknown): string | null {
  if (!payload || typeof payload !== 'object') return null
  const p = payload as Record<string, unknown>
  if (typeof p.content === 'string') return p.content
  if (Array.isArray(p.content)) {
    const part = p.content.find((c) => typeof c === 'object' && c !== null && 'text' in c) as
      | { text?: string }
      | undefined
    if (part?.text) return part.text
  }
  return null
}

await main()
