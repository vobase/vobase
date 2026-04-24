/**
 * Live smoke test: post an HMAC-signed inbound web message to a running dev
 * server, wait for the wake loop to reply, and print the conversation tail.
 *
 * Requires: `bun run dev:server` running on :3000 with OPENAI_API_KEY set.
 */

import { createHmac } from 'node:crypto'

const BASE = process.env.BASE_URL ?? 'http://localhost:3000'
const SECRET = process.env.CHANNEL_WEB_WEBHOOK_SECRET ?? 'dev-secret'
const CHANNEL_INSTANCE_ID = 'chi00web00'
const ORG_ID = 'mer0tenant'

const body = JSON.stringify({
  channelType: 'web',
  organizationId: ORG_ID,
  channelInstanceId: CHANNEL_INSTANCE_ID,
  from: `smoke-${Date.now()}`,
  profileName: 'Smoke Tester',
  content: 'Hi! What are your clinic hours?',
  contentType: 'text',
  externalMessageId: `smoke-${Date.now()}`,
  timestamp: Date.now(),
})

const sig = createHmac('sha256', SECRET).update(body).digest('hex')

const res = await fetch(`${BASE}/api/channel-web/inbound`, {
  method: 'POST',
  headers: {
    'content-type': 'application/json',
    'x-channel-instance-id': CHANNEL_INSTANCE_ID,
    'x-hub-signature-256': sig,
  },
  body,
})

const payload = await res.json()
console.log('inbound status:', res.status)
console.log('inbound payload:', payload)

if (!res.ok) process.exit(1)

const conversationId = (payload as { conversationId: string }).conversationId

// Poll the DB directly for the agent reply (HTTP route requires session).
const postgres = (await import('postgres')).default
const sql = postgres(process.env.DATABASE_URL ?? 'postgres://vobase:vobase@localhost:5433/vobase_v2')
try {
  for (let i = 0; i < 60; i += 1) {
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
      console.log(`  text=${agentReply.text}`)
      process.exit(0)
    }
    if (i % 5 === 0) console.log(`[poll ${i}s] messages so far: ${rows.length}`)
  }
  console.error('❌ timed out waiting for agent reply')
  process.exit(2)
} finally {
  await sql.end()
}
