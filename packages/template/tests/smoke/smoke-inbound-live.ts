#!/usr/bin/env bun
/**
 * Live smoke test — POST an HMAC-signed inbound web message to a running dev
 * server, then poll the DB until the agent harness produces a reply.
 *
 * Endpoint: POST /api/channels/adapters/web/inbound
 *   - `x-channel-instance-id` header carries the channel routing key.
 *   - `x-hub-signature-256: sha256=<hex>` carries the HMAC over the raw body.
 *   - When `x-channel-secret` is absent the server falls back to
 *     `process.env.CHANNEL_WEB_WEBHOOK_SECRET ?? 'dev-secret'`.
 *
 * Requires: `bun run dev:server` (or `bun run dev`) on :3000 with
 * `OPENAI_API_KEY` set so the wake harness can actually call the model.
 *
 * Usage: BASE_URL=http://localhost:3000 bun run tests/smoke/smoke-inbound-live.ts
 */

import { createHmac } from 'node:crypto'

const BASE = process.env.BASE_URL ?? 'http://localhost:3000'
const SECRET = process.env.CHANNEL_WEB_WEBHOOK_SECRET ?? 'dev-secret'
const CHANNEL_INSTANCE_ID = process.env.CHANNEL_INSTANCE_ID ?? 'chi00web00'
const ORG_ID = process.env.ORG_ID ?? 'mer0tenant'
const POLL_S = Number(process.env.POLL_S ?? 60)

// `channelInstanceId` is NOT in `ChannelInboundEventSchema` — the route reads
// it from the `x-channel-instance-id` header. Sending it in the body would
// fail zod validation.
const body = JSON.stringify({
  channelType: 'web',
  organizationId: ORG_ID,
  from: `smoke-${Date.now()}`,
  profileName: 'Smoke Tester',
  content: 'Hi! What are your clinic hours?',
  contentType: 'text',
  externalMessageId: `smoke-${Date.now()}`,
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

const rawText = await res.text()
console.log('inbound status:', res.status)
console.log('inbound body:', rawText)

if (!res.ok) process.exit(1)

let payload: { conversationId?: string }
try {
  payload = JSON.parse(rawText) as { conversationId?: string }
} catch {
  console.error('inbound returned non-JSON success body — handler shape changed?')
  process.exit(1)
}
const conversationId = payload.conversationId
if (!conversationId) {
  console.error('inbound success body missing conversationId:', rawText)
  process.exit(1)
}

// Poll the DB directly for the agent reply (HTTP route requires a session,
// and we're already past the webhook boundary that vouches for us).
// biome-ignore lint/plugin/no-dynamic-import: heavy optional dep
const postgres = (await import('postgres')).default
const sql = postgres(process.env.DATABASE_URL ?? 'postgres://vobase:vobase@localhost:5432/vobase')
try {
  for (let i = 0; i < POLL_S; i += 1) {
    await new Promise((r) => setTimeout(r, 1000))
    const rows = await sql<{ id: string; role: string; text: string | null }[]>`
      SELECT id, role, content->>'text' as text
      FROM messaging.messages
      WHERE conversation_id = ${conversationId}
      ORDER BY created_at ASC
    `
    const agentReply = rows.find((m) => m.role === 'agent')
    if (agentReply) {
      console.log('\n✅ agent replied:')
      console.log(`  id=${agentReply.id}`)
      console.log(`  text=${agentReply.text ?? '(non-text payload — likely a card)'}`)
      process.exit(0)
    }
    if (i % 5 === 0) console.log(`[poll ${i}s] messages so far: ${rows.length}`)
  }
  console.error('❌ timed out waiting for agent reply')
  process.exit(2)
} finally {
  await sql.end()
}
