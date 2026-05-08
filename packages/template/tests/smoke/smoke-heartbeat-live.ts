#!/usr/bin/env bun
/**
 * Live smoke for the heartbeat wake path. Hits dev-only
 * `POST /api/agents/schedules/:id/run` to fire one heartbeat, then polls
 * the harness journal for the standalone-lane assistant turn.
 *
 * Synthetic conversationId is `heartbeat-<scheduleId>`.
 *
 * Usage: BASE_URL=http://localhost:3000 bun run tests/smoke/smoke-heartbeat-live.ts
 */

import { devLogin, makeAuthedFetch } from './_helpers'
import {
  POLL_S_DEFAULTS,
  connectSmokeDb,
  countAssistantTurns,
  envPollS,
  pickText,
  pollAssistantTurns,
  runSmoke,
} from '../helpers/smoke-runtime'

const SCHEDULE_ID = process.env.SCHEDULE_ID ?? 'sch0bri0v1'
const EMAIL = process.env.SMOKE_EMAIL ?? 'alice@meridian.test'
const POLL_S = envPollS(POLL_S_DEFAULTS.heartbeat)
const SYNTH_CONV_ID = `heartbeat-${SCHEDULE_ID}`

await runSmoke(
  'heartbeat',
  async ({ baseUrl }) => {
    console.log(`[smoke:heartbeat] schedule=${SCHEDULE_ID} conv=${SYNTH_CONV_ID}`)
    const auth = await devLogin(baseUrl, EMAIL)
    const api = makeAuthedFetch(baseUrl, auth)
    const { sql, end } = connectSmokeDb()
    try {
      const baseline = await countAssistantTurns(sql, SYNTH_CONV_ID)
      console.log(`[smoke:heartbeat] baseline assistant turns=${baseline}`)

      const res = await api(`/api/agents/schedules/${SCHEDULE_ID}/run`, { method: 'POST' })
      const body = await res.text()
      if (!res.ok) throw new Error(`POST /run ${res.status}: ${body}`)
      console.log(`[smoke:heartbeat] ✓ POST run ${res.status}: ${body}`)

      const turns = await pollAssistantTurns({
        sql,
        conversationId: SYNTH_CONV_ID,
        baseline,
        timeoutS: POLL_S,
        label: '[smoke:heartbeat]',
      })
      const latest = turns[turns.length - 1]
      const text = pickText(latest?.payload)
      console.log(`[smoke:heartbeat] ✓ assistant turn id=${latest?.id} seq=${latest?.seq}`)
      console.log(`  text: ${text || '(non-text payload)'}`)
    } finally {
      await end()
    }
  },
  { dumpOnFailure: () => [SYNTH_CONV_ID], dumpOpts: { skipMessaging: true } },
)
