#!/usr/bin/env bun
/**
 * Before/after agent-behavior test template.
 *
 * Usage:
 *   1. Set BASE, WEBHOOK_SECRET, ORG_ID, CHANNEL_INSTANCE for your tenant
 *   2. Edit `policyText` and `inboundQuestion` to match your scenario
 *   3. Run: `bun .claude/skills/vobase-cli-ops/references/before-after-template.ts`
 *
 * Requires:
 *   - bun run dev:server up at $BASE
 *   - postgres reachable at the connection string below
 *   - ~/.vobase/<config>.json with an OWNER or ADMIN api key (the admin-tier
 *     `agents debug wakes` verb is dumped after each reply for forensics —
 *     a member-tier key still runs the test, but the wake dumps will fail)
 *   - OPENAI_API_KEY or ANTHROPIC_API_KEY in the server's env (real LLM wakes)
 *
 * The script preserves data: it captures the original drive file content,
 * runs the test, and restores the original at the end.
 *
 * Reading the output:
 *   - BEFORE/AFTER `agent reply:` is the customer-facing answer (the diff that
 *     matters)
 *   - BEFORE/AFTER `wakes:` summary shows trigger, turn count, tool count,
 *     cost, end reason, systemHash. If the AFTER systemHash differs from
 *     BEFORE, the drive mutation rebuilt the agent's prompt — consistent.
 *     If turns/tool counts shifted dramatically, drill in with
 *       `vobase agents debug timeline --wakeId=<id>`
 *       `vobase agents debug llm-io --wakeId=<id>`
 *     to see exactly what the LLM saw and decided.
 */
import { createHmac } from 'node:crypto'
import { spawnSync } from 'node:child_process'
import postgres from 'postgres'

// === EDIT THESE FOR YOUR TENANT ===
const BASE = 'http://localhost:3000'
// IMPORTANT: use `||` (not `??`) — Bun auto-loads `.env`, and an uncommented
// `CHANNEL_WEB_WEBHOOK_SECRET=` (empty value) would override the dev fallback.
const WEBHOOK_SECRET = process.env.CHANNEL_WEB_WEBHOOK_SECRET || 'dev-secret'
const ORG_ID = 'mer0tenant'
const CHANNEL_INSTANCE = 'chi00web00'
const VOBASE_CONFIG = 'smoke' // ~/.vobase/<this>.json — must hold an OWNER or ADMIN api key
const TARGET_DRIVE_PATH = '/pricing.md' // existing file the agent already cats
// IMPORTANT: must be a seeded org `owner` (admin tier) to call `agents debug *`.
// `alice@meridian.test` is owner in the canonical seed; `alice@meridian.dev` is member only.
const ADMIN_EMAIL = 'alice@meridian.test'
const ADMIN_USER_ID = 'usr0alice0'
// =================================

const policyText = `\n\n## Beta Tester Loyalty Discount\n\nAll customers who self-identify as beta testers receive a flat 15% loyalty discount. Promo code: BETA15.`
const inboundQuestion = "Hi! I'm a beta tester — does Meridian offer any loyalty discount? What's the percentage?"

const sql = postgres('postgres://vobase:vobase@localhost:5432/vobase')

async function sendInbound(from: string, content: string): Promise<{ conversationId: string }> {
  const payload = {
    channelType: 'web',
    organizationId: ORG_ID,
    from,
    profileName: 'BetaTester',
    content,
    contentType: 'text',
    externalMessageId: `${from}-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
    timestamp: Date.now(),
  }
  const body = JSON.stringify(payload)
  const sig = `sha256=${createHmac('sha256', WEBHOOK_SECRET).update(body).digest('hex')}`
  const res = await fetch(`${BASE}/api/channels/adapters/web/inbound`, {
    method: 'POST',
    headers: {
      'content-type': 'application/json',
      'x-channel-instance-id': CHANNEL_INSTANCE,
      'x-hub-signature-256': sig,
    },
    body,
  })
  if (!res.ok) throw new Error(`inbound ${res.status}: ${await res.text()}`)
  return await res.json()
}

function extractText(content: any): string {
  if (typeof content === 'string') return content
  if (content?.text) return content.text
  if (content?.card?.children) {
    return content.card.children
      .map((c: any) =>
        c.type === 'text'
          ? c.content
          : c.type === 'actions'
            ? `[${c.children?.map((b: any) => b.label).join(' | ')}]`
            : '',
      )
      .filter(Boolean)
      .join('\n')
  }
  return JSON.stringify(content).slice(0, 400)
}

async function waitForAgentReply(conversationId: string, timeoutMs = 90_000): Promise<string> {
  const start = Date.now()
  while (Date.now() - start < timeoutMs) {
    const rows = await sql<{ content: any }[]>`
      SELECT content FROM messaging.messages
      WHERE conversation_id = ${conversationId} AND role = 'agent'
      ORDER BY created_at ASC
    `
    if (rows.length > 0) return extractText(rows[rows.length - 1].content)
    await new Promise((r) => setTimeout(r, 1500))
  }
  throw new Error(`no agent reply within ${timeoutMs}ms for conv ${conversationId}`)
}

function vobase(args: string[]): { stdout: string; stderr: string; code: number } {
  const r = spawnSync('bun', ['/Users/carl/vobase/packages/cli/bin/vobase.ts', ...args], {
    env: { ...process.env, VOBASE_CONFIG },
    encoding: 'utf-8',
  })
  return { stdout: r.stdout ?? '', stderr: r.stderr ?? '', code: r.status ?? 1 }
}

/**
 * Forensic dump of every wake fired against `conversationId`. Surfaces:
 *   - wakeId (use it to drill into `agents debug timeline --wakeId=…` /
 *     `agents debug llm-io --wakeId=…` if a row looks suspicious)
 *   - trigger + brief triggerPayloadPreview (which inbound caused the wake)
 *   - turn count, tool count, cost
 *   - systemHash (drift across wakes for the same agent + conversation =
 *     frozen-snapshot violation, real bug)
 *   - endReason (`complete` / `blocked` / `aborted` / `error`)
 * Pure side-effect logging; never throws on bad data so it can't mask the
 * agent-behavior diff that's the actual point of the test.
 */
type WakeRow = {
  wakeId: string
  trigger: string | null
  triggerPayloadPreview: string | null
  startedAt: string
  turns: number
  toolCalls: number
  costUsd: number
  systemHash: string | null
  endReason: string | null
}
function dumpWakes(label: string, conversationId: string): void {
  const r = vobase(['--json', 'agents', 'debug', 'wakes', `--conversationId=${conversationId}`])
  if (r.code !== 0) {
    console.log(`[${label}] wake dump failed (${r.code}): ${r.stderr.trim().slice(0, 200)}`)
    return
  }
  let rows: WakeRow[]
  try {
    rows = JSON.parse(r.stdout) as WakeRow[]
  } catch {
    console.log(`[${label}] wake dump returned non-JSON: ${r.stdout.trim().slice(0, 200)}`)
    return
  }
  if (rows.length === 0) {
    console.log(`[${label}] no wakes recorded for ${conversationId}`)
    return
  }
  console.log(`[${label}] wakes (${rows.length}):`)
  for (const w of rows) {
    const hash = w.systemHash ? `${w.systemHash.slice(0, 12)}…` : 'none'
    const trig = w.trigger ?? '?'
    const cost = `$${w.costUsd.toFixed(5)}`
    console.log(
      `  ${w.wakeId} ${trig.padEnd(18)} turns=${w.turns} tools=${w.toolCalls} cost=${cost} end=${w.endReason ?? '?'} hash=${hash}`,
    )
    if (w.triggerPayloadPreview) console.log(`    cue: ${w.triggerPayloadPreview.slice(0, 140)}`)
  }
}

async function getDevSessionCookie(email: string): Promise<string> {
  const res = await fetch(`${BASE}/api/auth/dev-login`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ email }),
  })
  if (!res.ok) throw new Error(`dev-login: ${res.status}`)
  return res.headers.get('set-cookie')!.split(';')[0]
}

async function decidePending(cookie: string, decidedByUserId: string): Promise<number> {
  const rows = await sql<{ id: string }[]>`
    SELECT id FROM changes.change_proposals
    WHERE organization_id = ${ORG_ID} AND status = 'pending'
  `
  for (const row of rows) {
    const res = await fetch(`${BASE}/api/changes/proposals/${row.id}/decide`, {
      method: 'POST',
      headers: { 'content-type': 'application/json', cookie },
      body: JSON.stringify({ decision: 'approved', decidedByUserId, note: 'before-after test' }),
    })
    if (!res.ok) console.warn(`decide ${row.id} failed: ${res.status}`)
  }
  return rows.length
}

console.log('=== Before/After agent-behavior test ===\n')

// --- BEFORE: capture original drive content
const [{ extracted_text: originalContent }] = await sql<{ extracted_text: string }[]>`
  SELECT extracted_text FROM drive.files
  WHERE path = ${TARGET_DRIVE_PATH} AND scope = 'organization' AND organization_id = ${ORG_ID}
`
console.log(`[BEFORE] ${TARGET_DRIVE_PATH} length: ${originalContent.length}`)

// --- BEFORE: send inbound, capture reply
const fromBefore = `web-test-${Date.now()}-before`
console.log(`\n[BEFORE] inbound from ${fromBefore}`)
const inboundBefore = await sendInbound(fromBefore, inboundQuestion)
const replyBefore = await waitForAgentReply(inboundBefore.conversationId).catch((e) => `[wake failed: ${e.message}]`)
console.log(`\n[BEFORE] agent reply:\n${replyBefore}\n`)
dumpWakes('BEFORE', inboundBefore.conversationId)

// --- MUTATION: append the policy text via drive propose
const updatedContent = `${originalContent}${policyText}`
const proposeRes = vobase([
  '--json',
  'drive',
  'propose',
  `--path=${TARGET_DRIVE_PATH}`,
  `--body=${updatedContent}`,
  '--rationale=before-after agent-behavior test',
  '--confidence=0.95',
])
console.log('[CLI] propose:', proposeRes.stdout.trim().slice(0, 200))
console.log('[CLI] exit:', proposeRes.code)

// Decide any pending proposals (high-sensitivity routing kicks them to pending even at high confidence)
const cookie = await getDevSessionCookie(ADMIN_EMAIL)
const decided = await decidePending(cookie, ADMIN_USER_ID)
console.log(`[CLI] decided ${decided} pending proposals`)

// Wait for materialization
await new Promise((r) => setTimeout(r, 2000))

// --- AFTER: send inbound from a fresh contact (avoid memory contamination)
const fromAfter = `web-test-${Date.now()}-after`
console.log(`\n[AFTER] inbound from ${fromAfter}`)
const inboundAfter = await sendInbound(fromAfter, inboundQuestion)
const replyAfter = await waitForAgentReply(inboundAfter.conversationId).catch((e) => `[wake failed: ${e.message}]`)
console.log(`\n[AFTER] agent reply:\n${replyAfter}\n`)
dumpWakes('AFTER', inboundAfter.conversationId)

// --- DIFF
console.log('=== DIFF ===')
console.log(`BEFORE length: ${replyBefore.length}, AFTER length: ${replyAfter.length}`)
console.log(`BEFORE first 200 chars: ${replyBefore.slice(0, 200).replace(/\n/g, ' ')}`)
console.log(`AFTER  first 200 chars: ${replyAfter.slice(0, 200).replace(/\n/g, ' ')}`)

// --- RESTORE
await sql`
  UPDATE drive.files SET extracted_text = ${originalContent}
  WHERE path = ${TARGET_DRIVE_PATH} AND scope = 'organization' AND organization_id = ${ORG_ID}
`
console.log(`\n[CLEANUP] restored ${TARGET_DRIVE_PATH} to original (${originalContent.length} chars)`)

await sql.end()
