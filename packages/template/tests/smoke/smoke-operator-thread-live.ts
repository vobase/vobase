#!/usr/bin/env bun
/**
 * Live smoke for the operator_thread wake path. Posts a fresh staff message
 * to the seeded `thd0smoke01` thread (Sentinel) and polls the agent_messages
 * journal for an assistant turn keyed by the synthetic conversationId
 * `operator-thd0smoke01`.
 *
 * Usage: BASE_URL=http://localhost:3000 bun run tests/smoke/smoke-operator-thread-live.ts
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

const ORG_ID = process.env.ORG_ID ?? 'mer0tenant'
const THREAD_ID = process.env.THREAD_ID ?? 'thd0smoke01'
const EMAIL = process.env.SMOKE_EMAIL ?? 'alice@meridian.test'
const POLL_S = envPollS(POLL_S_DEFAULTS.operator)
const PROMPT =
  process.env.PROMPT ??
  `Smoke test ${new Date().toISOString()} — quick brief: how many active conversations are open right now, and which one is oldest?`
const SYNTH_CONV_ID = `operator-${THREAD_ID}`

await runSmoke(
  'op-thread',
  async ({ baseUrl }) => {
    console.log(`[smoke:op-thread] thread=${THREAD_ID} conv=${SYNTH_CONV_ID}`)
    const auth = await devLogin(baseUrl, EMAIL)
    const api = makeAuthedFetch(baseUrl, auth)
    const { sql, end } = connectSmokeDb()
    try {
      const baseline = await countAssistantTurns(sql, SYNTH_CONV_ID)
      console.log(`[smoke:op-thread] baseline assistant turns=${baseline}`)

      const res = await api(`/api/agents/threads/${THREAD_ID}/messages`, {
        method: 'POST',
        body: JSON.stringify({ organizationId: ORG_ID, content: PROMPT }),
      })
      const body = await res.text()
      if (!res.ok) throw new Error(`POST messages ${res.status}: ${body}`)
      console.log(`[smoke:op-thread] ✓ POST messages ${res.status}: ${body}`)

      const turns = await pollAssistantTurns({
        sql,
        conversationId: SYNTH_CONV_ID,
        baseline,
        timeoutS: POLL_S,
        label: '[smoke:op-thread]',
      })
      const latest = turns[turns.length - 1]
      const text = pickText(latest?.payload)
      console.log(`[smoke:op-thread] ✓ assistant turn id=${latest?.id} seq=${latest?.seq}`)
      console.log(`  text: ${text || '(non-text payload)'}`)
    } finally {
      await end()
    }
  },
  { dumpOnFailure: () => [SYNTH_CONV_ID], dumpOpts: { skipMessaging: true } },
)
