#!/usr/bin/env bun

/**
 * Live smoke — POST an HMAC-signed inbound web message to a running dev
 * server and wait for the agent's first reply on `messaging.messages`.
 *
 * Requires: `bun run dev:server` on :3000 with `OPENAI_API_KEY` set.
 *
 * Usage: BASE_URL=http://localhost:3000 bun run tests/smoke/smoke-inbound-live.ts
 */

import { open as openSmokeCtx, sendInbound } from '../helpers/changes-smoke'
import { envPollS, POLL_S_DEFAULTS, pollAssistantTurns, runSmoke } from '../helpers/smoke-runtime'

const CONTENT = process.env.CONTENT ?? 'Hi! What are your clinic hours?'
const POLL_S = envPollS(POLL_S_DEFAULTS.inbound)

let conversationId: string | null = null

await runSmoke(
  'inbound',
  async ({ baseUrl }) => {
    const ctx = await openSmokeCtx({ baseUrl })
    try {
      const result = await sendInbound(ctx, CONTENT)
      conversationId = result.conversationId
      console.log(`[smoke:inbound] conversation=${conversationId} message=${result.messageId}`)

      const turns = await pollAssistantTurns({
        sql: ctx.sql,
        conversationId,
        baseline: 0,
        timeoutS: POLL_S,
        label: '[smoke:inbound]',
      })
      console.log(`[smoke:inbound] agent produced ${turns.length} assistant turn(s)`)
    } finally {
      await ctx.sql.end()
    }
  },
  { dumpOnFailure: () => (conversationId ? [conversationId] : []) },
)
