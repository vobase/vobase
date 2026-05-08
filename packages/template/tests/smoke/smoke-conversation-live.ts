#!/usr/bin/env bun

/**
 * Multi-turn live smoke. Sends a sequence of HMAC-signed inbound messages
 * to a running dev server using a *single* `from` so they all land on the
 * same conversation, polls the messaging surface for the agent reply
 * between turns, then dumps the final transcript + proposals + lifecycle.
 *
 * Usage: bun run tests/smoke/smoke-conversation-live.ts [scenario]
 *
 * Scenarios (positional, default `mixed`): hours, update, phone, correction, mixed.
 * Env: BASE_URL=http://localhost:3000, POLL_S=120, FROM_PREFIX=smoke-conv.
 */

import { open as openSmokeCtx, sendInbound, waitForReply } from '../helpers/changes-smoke'
import { dumpConversationState, envPollS, POLL_S_DEFAULTS, runSmoke } from '../helpers/smoke-runtime'

type Turn = { content: string; expectProposal?: boolean }

const SCENARIOS: Record<string, Turn[]> = {
  hours: [
    { content: 'Hi! What time do you open today?' },
    { content: 'And tomorrow?' },
    { content: 'Thanks! One more — are you open on Sundays?' },
  ],
  update: [
    { content: 'Hey, can you update my email to ada-update1@example.com please?', expectProposal: true },
    { content: 'Also update my phone to +6591234567 if you can.', expectProposal: true },
    { content: 'Thanks!' },
  ],
  // Phone-only — single turn, no prior pending proposal to entangle with the
  // per-resource duplicate guard. Verifies the auto-rewrite path
  // (attributes.phone → phone) and the conversationId forwarding into
  // change.proposed/auto_applied lifecycle events end-to-end.
  phone: [{ content: 'Hi! Could you please update my phone number to +6591234567?', expectProposal: true }],
  correction: [
    { content: 'Please change my email to ada-typo@exmple.com', expectProposal: true },
    { content: "Sorry I made a typo — it should be ada-typo@example.com (with an 'a').", expectProposal: true },
    { content: 'Cheers!' },
  ],
  mixed: [
    { content: "Hi! I'm thinking about signing up. What hours are you open?" },
    { content: 'Could you also update my email to ada-mixed@example.com on file?', expectProposal: true },
    { content: 'And what is your refund policy like?' },
    { content: 'One more thing — please change my phone to +6598765432.', expectProposal: true },
    { content: 'Thanks!' },
  ],
}

const scenarioName = (process.argv[2] ?? 'mixed').toLowerCase()
const scenario = SCENARIOS[scenarioName]
if (!scenario) {
  console.error(`unknown scenario: ${scenarioName}. valid: ${Object.keys(SCENARIOS).join(', ')}`)
  process.exit(1)
}

const POLL_S = envPollS(POLL_S_DEFAULTS.conversation)
const FROM_PREFIX = process.env.FROM_PREFIX ?? 'smoke-conv'
const FROM = `${FROM_PREFIX}-${Date.now()}`

console.log(`scenario: ${scenarioName}  (${scenario.length} turns, from=${FROM})`)

let conversationId: string | null = null

await runSmoke(
  'conversation',
  async ({ baseUrl }) => {
    const ctx = await openSmokeCtx({ baseUrl, from: FROM })
    try {
      let replyCount = 0
      for (let i = 0; i < scenario.length; i += 1) {
        const turn = scenario[i]
        if (!turn) continue
        console.log(`\n→ turn ${i + 1}/${scenario.length}: ${turn.content}`)
        const result = await sendInbound(ctx, turn.content)
        conversationId = result.conversationId

        const reply = await waitForReply(ctx, conversationId, replyCount, { timeoutS: POLL_S })
        replyCount += 1
        console.log(`← agent: ${reply.text}`)

        // Brief pause so agent_end / wake-cleanup settles before next inbound.
        await new Promise((r) => setTimeout(r, 500))
      }

      if (!conversationId) throw new Error('no conversationId — nothing posted')

      console.log('\n────────────  FINAL STATE  ────────────')
      console.log(`conversation: ${conversationId}`)
      // Reuse the canonical dumper for proposals + lifecycle so the success
      // path and failure path render identically.
      await dumpConversationState(ctx.sql, conversationId, { messagesLimit: 20 })

      const proposals = await ctx.sql<{ id: string }[]>`
        SELECT id FROM changes.change_proposals WHERE conversation_id = ${conversationId}
      `
      const events = await ctx.sql<{ type: string }[]>`
        SELECT type FROM harness.conversation_events
        WHERE conversation_id = ${conversationId} AND type LIKE 'change.%'
      `
      const expected = scenario.filter((t) => t.expectProposal).length
      if (proposals.length !== expected) {
        throw new Error(`expected ${expected} proposals, got ${proposals.length}`)
      }
      if (events.length !== expected) {
        throw new Error(`expected ${expected} change.* events, got ${events.length}`)
      }
      console.log(`assertion: ${expected} proposals + ${expected} change.* events ✅`)
    } finally {
      await ctx.sql.end()
    }
  },
  { dumpOnFailure: () => (conversationId ? [conversationId] : []) },
)
