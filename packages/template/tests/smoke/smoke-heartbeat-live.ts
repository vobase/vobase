#!/usr/bin/env bun

/**
 * Live smoke for the heartbeat wake path. Hits the dev-only
 * `POST /api/agents/schedules/:id/run` endpoint to fire one heartbeat for the
 * Atlas weekly-content-review schedule (`sch0wkr0v1`), then polls the
 * harness journal for the resulting standalone-lane assistant turn.
 *
 * Synthetic conversationId for heartbeats is `heartbeat-<scheduleId>`; the
 * harness threads journal is (agentId, conversationId), so the assistant
 * payload lands deterministically.
 *
 * Requires:
 *   - dev server on :3000 (`bun run dev:server`)
 *   - OPENAI_API_KEY (or BIFROST) so the harness can actually drive the model
 *
 * Usage: BASE_URL=http://localhost:3000 bun run tests/smoke/smoke-heartbeat-live.ts
 */

import { devLogin, makeAuthedFetch } from './_helpers'

const BASE_URL = process.env.BASE_URL ?? 'http://localhost:3000'
const SCHEDULE_ID = process.env.SCHEDULE_ID ?? 'sch0bri0v1'
const EMAIL = process.env.SMOKE_EMAIL ?? 'alice@meridian.test'
const POLL_S = Number(process.env.POLL_S ?? 90)

const SYNTH_CONV_ID = `heartbeat-${SCHEDULE_ID}`

async function main() {
  console.log(`[smoke:heartbeat] target=${BASE_URL} schedule=${SCHEDULE_ID} conv=${SYNTH_CONV_ID}`)

  const auth = await devLogin(BASE_URL, EMAIL)
  const api = makeAuthedFetch(BASE_URL, auth)

  // biome-ignore lint/plugin/no-dynamic-import: heavy optional dep
  const postgres = (await import('postgres')).default
  const sql = postgres(process.env.DATABASE_URL ?? 'postgres://vobase:vobase@localhost:5432/vobase')
  try {
    const baseline = await sql<{ count: number }[]>`
      SELECT count(*)::int FROM harness.messages m
      JOIN harness.threads t ON t.id = m.thread_id
      WHERE t.conversation_id = ${SYNTH_CONV_ID}
        AND m.payload->>'role' = 'assistant'
    `
    const baseAssistantCount = baseline[0]?.count ?? 0
    console.log(`[smoke:heartbeat] baseline assistant turns=${baseAssistantCount}`)

    const postRes = await api(`/api/agents/schedules/${SCHEDULE_ID}/run`, { method: 'POST' })
    const postBody = await postRes.text()
    if (!postRes.ok) {
      console.error(`[smoke:heartbeat] ✗ POST run ${postRes.status}: ${postBody}`)
      process.exit(1)
    }
    console.log(`[smoke:heartbeat] ✓ POST run ${postRes.status}: ${postBody}`)

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
          console.error('[smoke:heartbeat] ✗ unexpected: count grew but no row')
          process.exit(1)
        }
        const text = pickText(latest.payload)
        console.log('\n✅ standalone-lane heartbeat wake produced an assistant turn:')
        console.log(`  id=${latest.id} seq=${latest.seq}`)
        console.log(`  text=${text ?? '(non-text payload — see payload field)'}`)
        process.exit(0)
      }
      if (i % 5 === 0) console.log(`[poll ${i}s] assistant turns so far: ${rows.length}`)
    }
    console.error('❌ timed out waiting for heartbeat assistant turn')
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
