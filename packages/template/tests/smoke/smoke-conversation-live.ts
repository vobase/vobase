#!/usr/bin/env bun
/**
 * Multi-turn live smoke. Sends a sequence of HMAC-signed inbound messages
 * to a running dev server using a *single* `from` so they all land on the
 * same conversation, polls the DB for the agent reply between turns, then
 * dumps the full transcript + any change proposals + lifecycle events.
 *
 * Usage:
 *   bun run tests/smoke/smoke-conversation-live.ts [scenario]
 *
 * Scenarios (positional, default `mixed`):
 *   - `hours`     — pure read-only, no proposals expected.
 *   - `update`    — customer asks to update email, then phone.
 *   - `correction`— customer asks for email update, then corrects it.
 *   - `mixed`     — hours → email update → another question → phone update.
 *
 * Env: BASE_URL=http://localhost:3000, POLL_S=120, FROM_PREFIX=smoke-conv.
 */

import { createHmac } from 'node:crypto'

const BASE = process.env.BASE_URL ?? 'http://localhost:3000'
const SECRET = process.env.CHANNEL_WEB_WEBHOOK_SECRET || 'dev-secret'
const CHANNEL_INSTANCE_ID = process.env.CHANNEL_INSTANCE_ID ?? 'chi00web00'
const ORG_ID = process.env.ORG_ID ?? 'mer0tenant'
const POLL_S = Number(process.env.POLL_S ?? 120)
const FROM_PREFIX = process.env.FROM_PREFIX ?? 'smoke-conv'

// Stable `from` so every turn lands on the same conversation. Suffix with
// the run timestamp so re-runs produce fresh contacts (otherwise the second
// run would reuse the prior conversation and the assertions would conflate).
const FROM = `${FROM_PREFIX}-${Date.now()}`

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

console.log(`scenario: ${scenarioName}  (${scenario.length} turns, from=${FROM})`)

async function postInbound(content: string): Promise<{ conversationId: string; messageId: string }> {
  const body = JSON.stringify({
    channelType: 'web',
    organizationId: ORG_ID,
    from: FROM,
    profileName: 'Smoke Conversation',
    content,
    contentType: 'text',
    externalMessageId: `smoke-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
    timestamp: Date.now(),
  })
  const sig = `sha256=${createHmac('sha256', SECRET).update(body).digest('hex')}`
  const res = await fetch(`${BASE}/api/channels/adapters/web/inbound`, {
    method: 'POST',
    headers: {
      'content-type': 'application/json',
      'x-channel-instance-id': CHANNEL_INSTANCE_ID,
      'x-hub-signature-256': sig,
    },
    body,
  })
  const text = await res.text()
  if (!res.ok) {
    console.error('inbound failed:', res.status, text)
    process.exit(1)
  }
  return JSON.parse(text) as { conversationId: string; messageId: string }
}

// biome-ignore lint/plugin/no-dynamic-import: heavy optional dep
const postgres = (await import('postgres')).default
const sql = postgres(process.env.DATABASE_URL ?? 'postgres://vobase:vobase@localhost:5432/vobase')

interface MessageRow {
  id: string
  role: string
  text: string | null
  created_at: Date
}

async function readMessages(conversationId: string): Promise<MessageRow[]> {
  return await sql<MessageRow[]>`
    SELECT id, role, content->>'text' AS text, created_at
    FROM messaging.messages
    WHERE conversation_id = ${conversationId}
    ORDER BY created_at ASC
  `
}

let conversationId: string | null = null

try {
  for (let i = 0; i < scenario.length; i += 1) {
    const turn = scenario[i]
    if (!turn) continue
    console.log(`\n→ turn ${i + 1}/${scenario.length}: ${turn.content}`)
    const { conversationId: convId } = await postInbound(turn.content)
    conversationId = convId

    // Poll for the next agent reply (created_at > the latest existing one).
    // First inbound creates the conversation; subsequent inbound rows reuse it.
    const before = await readMessages(convId)
    const beforeCount = before.length

    let replied = false
    for (let s = 0; s < POLL_S; s += 1) {
      await new Promise((r) => setTimeout(r, 1000))
      const after = await readMessages(convId)
      if (after.length > beforeCount) {
        const latest = after[after.length - 1]
        if (latest && latest.role === 'agent') {
          console.log(`← agent (${s + 1}s): ${latest.text}`)
          replied = true
          break
        }
        // Sometimes the agent posts intermediate messages (cards, etc.); keep polling.
      }
      if ((s + 1) % 15 === 0) console.log(`   …${s + 1}s, messages so far=${after.length}`)
    }
    if (!replied) {
      console.error(`✗ agent did not reply within ${POLL_S}s`)
      process.exit(2)
    }

    // Brief pause between turns so the harness's agent_end / wake-cleanup
    // settles before the next inbound creates a new wake.
    await new Promise((r) => setTimeout(r, 500))
  }

  if (!conversationId) {
    console.error('no conversationId — nothing posted?')
    process.exit(2)
  }

  console.log('\n────────────  FINAL STATE  ────────────')
  console.log(`conversation: ${conversationId}`)

  const proposals = await sql<{ id: string; status: string; payload: unknown; rationale: string | null }[]>`
    SELECT id, status, payload, rationale
    FROM changes.change_proposals
    WHERE conversation_id = ${conversationId}
    ORDER BY created_at ASC
  `
  console.log(`\nproposals (${proposals.length}):`)
  for (const p of proposals) {
    console.log(`  [${p.status}] ${p.id}: ${p.rationale ?? ''}`)
    console.log(`    payload: ${JSON.stringify(p.payload)}`)
  }

  const events = await sql<{ type: string; ts: Date; payload: Record<string, unknown> }[]>`
    SELECT type, ts, payload
    FROM harness.conversation_events
    WHERE conversation_id = ${conversationId} AND type LIKE 'change.%'
    ORDER BY ts ASC
  `
  console.log(`\nchange.* lifecycle events (${events.length}):`)
  for (const e of events) {
    const summary = (e.payload?.summary as string | undefined) ?? ''
    const proposedBy = (e.payload?.proposedBy as string | undefined) ?? ''
    const decidedBy = (e.payload?.decidedBy as string | undefined) ?? ''
    const actor = decidedBy || proposedBy
    console.log(`  ${e.ts.toISOString()}  ${e.type}  [actor=${actor}]  ${summary}`)
  }

  const expectedProposals = scenario.filter((t) => t.expectProposal).length
  const ok = proposals.length === expectedProposals && events.length === expectedProposals
  console.log(`\nassertion: expected ${expectedProposals} proposals, got ${proposals.length} (${ok ? '✅' : '✗'})`)
  console.log(
    `assertion: expected ${expectedProposals} change.proposed events, got ${events.length} (${ok ? '✅' : '✗'})`,
  )
  if (!ok) process.exit(3)
} finally {
  await sql.end()
}
