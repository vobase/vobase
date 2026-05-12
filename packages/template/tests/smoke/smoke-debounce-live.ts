#!/usr/bin/env bun

/**
 * Live smoke — verify wake debouncing.
 *
 * Sends 5 rapid customer inbound messages (~200ms apart) and asserts the
 * agent fires exactly one wake (not five). The trailing-edge debounce in
 * `modules/channels/service/inbound.ts` and the web handler at
 * `modules/channels/adapters/web/handlers/inbound.ts` reset the scheduler
 * timer on each enqueue (`runtime/bootstrap.ts:131-145`), and the in-flight
 * lease in `wake/inbound.ts` guards against any racing dequeue.
 *
 * Symptom this guards against: customer taps a burst of quick-reply chips
 * in the inbox UI; pre-fix, every tap spawned its own wake and the agent
 * raced itself emitting duplicate cards (production conversation `zpbjom4j`
 * showed 8 duplicate cards from 9 chip taps).
 *
 * Requires: `bun run dev:server` on :3000 with `OPENAI_API_KEY` set.
 *
 * Usage: BASE_URL=http://localhost:3000 bun run tests/smoke/smoke-debounce-live.ts
 */

import { WEB_DEBOUNCE_WINDOW_MS } from '@modules/channels/adapters/web/adapter'

import { open as openSmokeCtx, sendInbound } from '../helpers/changes-smoke'
import { envPollS, POLL_S_DEFAULTS, pollAssistantTurns, runSmoke } from '../helpers/smoke-runtime'

const BURST_SIZE = Number(process.env.BURST_SIZE ?? 5)
const BURST_GAP_MS = Number(process.env.BURST_GAP_MS ?? 100)
const POLL_S = envPollS(POLL_S_DEFAULTS.inbound)

// BURST_GAP_MS * (BURST_SIZE - 1) must stay well below WEB_DEBOUNCE_WINDOW_MS
// so the entire burst lands inside one debounce window even on a slow CI.
if (BURST_GAP_MS * (BURST_SIZE - 1) >= WEB_DEBOUNCE_WINDOW_MS) {
  throw new Error(
    `smoke config invalid: burst span ${BURST_GAP_MS * (BURST_SIZE - 1)}ms exceeds debounce window ${WEB_DEBOUNCE_WINDOW_MS}ms`,
  )
}

const CHIPS = [
  'What treatments do you have?',
  'Show prices',
  'Treatment durations',
  'Help me choose',
  'Package prices',
]

let conversationId: string | null = null

async function countAgentStarts(sql: Awaited<ReturnType<typeof openSmokeCtx>>['sql'], convId: string, since: Date): Promise<number> {
  const rows = await sql<{ count: number }[]>`
    SELECT count(*)::int AS count
    FROM harness.conversation_events
    WHERE conversation_id = ${convId}
      AND type = 'agent_start'
      AND ts >= ${since}
  `
  return rows[0]?.count ?? 0
}

await runSmoke(
  'debounce',
  async ({ baseUrl }) => {
    const ctx = await openSmokeCtx({ baseUrl })
    try {
      const burstStart = new Date()
      for (let i = 0; i < BURST_SIZE; i += 1) {
        const result = await sendInbound(ctx, CHIPS[i % CHIPS.length])
        conversationId ??= result.conversationId
        if (i < BURST_SIZE - 1) await new Promise((r) => setTimeout(r, BURST_GAP_MS))
      }
      console.log(`[smoke:debounce] sent ${BURST_SIZE} msgs in ${Date.now() - burstStart.getTime()}ms — conversation=${conversationId}`)
      if (!conversationId) throw new Error('no conversationId from burst')

      await pollAssistantTurns({
        sql: ctx.sql,
        conversationId,
        baseline: 0,
        timeoutS: POLL_S,
        label: '[smoke:debounce]',
      })

      // Stability poll: a racing second wake (if debounce broke) shows up
      // after the first reply with arbitrary lag. Snapshot the agent_start
      // count and require it to stay unchanged across two consecutive 1.5s
      // polls before asserting.
      let prev = await countAgentStarts(ctx.sql, conversationId, burstStart)
      let stable = 0
      while (stable < 2) {
        await new Promise((r) => setTimeout(r, 1500))
        const next = await countAgentStarts(ctx.sql, conversationId, burstStart)
        stable = next === prev ? stable + 1 : 0
        prev = next
      }

      console.log(`[smoke:debounce] agent_start count = ${prev} (expected: 1)`)
      if (prev > 1) {
        throw new Error(
          `debounce broken: ${BURST_SIZE} burst msgs produced ${prev} wakes (expected 1). ` +
            `Check producer singletonKey+startAfter in channels/service/inbound.ts and ` +
            `channels/adapters/web/handlers/inbound.ts.`,
        )
      }
    } finally {
      await ctx.sql.end()
    }
  },
  { dumpOnFailure: () => (conversationId ? [conversationId] : []) },
)
