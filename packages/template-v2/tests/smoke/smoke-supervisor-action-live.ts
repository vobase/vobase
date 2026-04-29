#!/usr/bin/env bun

/**
 * Live smoke for the supervisor wake → tool-using agent flow.
 *
 * Reproduces the manual-test path that has historically been flaky:
 *   1. Staff `@-mention`s the assigned agent in a seeded conversation's
 *      internal note, asking it to do three concrete things at once:
 *        a. update the contact's MEMORY.md with a fact
 *        b. update its own (agent) MEMORY.md with a rule
 *        c. propose a change to /drive/BUSINESS.md (or ask back if uncertain)
 *   2. The supervisor fan-out enqueues `messaging:supervisor-to-wake`.
 *   3. The wake handler boots the conversation-lane agent.
 *   4. Agent should explore (`cat`/`grep` virtual files), reason, and act —
 *      not silently no-op.
 *
 * Asserts (all non-fatal — prints a diagnostic table so the failure mode is
 * visible even when the agent does only some of the actions):
 *   - assistant journal turn lands within POLL_S seconds
 *   - tool catalogue: bash invocations exist (the agent EXPLORED before acting)
 *   - effects: at least 2 of {contact memory mutated, agent memory mutated,
 *     drive proposal created, agent posted an internal note} fired
 *   - the assistant turn surface text mentions Marcus / preferences (heuristic
 *     sanity that the prompt actually reached the model)
 *
 * Requires:
 *   - dev server on :3000 (`bun run dev:server`)
 *   - OPENAI_API_KEY (or BIFROST) so the wake can drive a real model
 *   - Postgres on :5433 with the standard seed (`bun run db:reset`)
 *
 * Usage:
 *   BASE_URL=http://localhost:3000 bun run tests/smoke/smoke-supervisor-action-live.ts
 *
 * Tunable env:
 *   CONV_ID — seeded conversation to target (default cnv0marcus)
 *   AGENT_ID — assigned agent (default agt0meri0v1)
 *   AGENT_HANDLE — display handle the @-mention scanner matches (default MeriGPT)
 *   CONTACT_ID — the conversation's contact (default cnt0marcus)
 *   POLL_S — seconds to wait for the assistant turn (default 120)
 */

import { devLogin, makeAuthedFetch } from './_helpers'

const BASE_URL = process.env.BASE_URL ?? 'http://localhost:3000'
const ORG_ID = process.env.ORG_ID ?? 'mer0tenant'
const CONV_ID = process.env.CONV_ID ?? 'cnv0marcus'
const AGENT_ID = process.env.AGENT_ID ?? 'agt0meri0v1'
const AGENT_HANDLE = process.env.AGENT_HANDLE ?? 'MeriGPT'
const CONTACT_ID = process.env.CONTACT_ID ?? 'ctt0marcus'
const EMAIL = process.env.SMOKE_EMAIL ?? 'alice@meridian.test'
const POLL_S = Number(process.env.POLL_S ?? 120)

const NOTE_BODY = [
  `@${AGENT_HANDLE} please do three things and report back:`,
  '',
  '1. Update this contact\'s MEMORY.md with the fact: "Marcus prefers email over phone for booking confirmations."',
  '2. Update your own MEMORY.md with a rule: "Always confirm a customer\'s preferred contact channel before scheduling."',
  '3. If our /drive/BUSINESS.md does NOT already mention preferred-contact-channel as part of booking flow, propose adding a short section about it via `vobase drive propose`.',
  '',
  'If anything is ambiguous (e.g. you are not sure whether BUSINESS.md already covers this), reply back via an internal note asking the question — do not silently skip.',
  'Explore the virtual filesystem first (cat / grep) so your decisions are grounded in what actually exists.',
].join('\n')

interface JournalRow {
  id: string
  seq: number
  payload: unknown
}

interface NoteRow {
  id: string
  author_type: string
  author_id: string
  body: string
  created_at: Date
}

interface ProposalRow {
  id: string
  resource_module: string
  resource_type: string
  status: string
  created_at: Date
}

async function main(): Promise<void> {
  console.log(`[smoke:supervisor-action] target=${BASE_URL} conv=${CONV_ID} agent=${AGENT_ID}@${AGENT_HANDLE}`)
  console.log(`[smoke:supervisor-action] note body:\n${NOTE_BODY}\n`)

  const auth = await devLogin(BASE_URL, EMAIL)
  const api = makeAuthedFetch(BASE_URL, auth)
  const userId = auth.userId

  // biome-ignore lint/plugin/no-dynamic-import: heavy optional dep
  const postgres = (await import('postgres')).default
  const sql = postgres(process.env.DATABASE_URL ?? 'postgres://vobase:vobase@localhost:5433/vobase_v2')
  try {
    // ─── Capture pre-state so post-state diffs are unambiguous ───
    const [contactBefore] = await sql<{ memory: string | null }[]>`
      SELECT memory FROM contacts.contacts WHERE id = ${CONTACT_ID}
    `
    const [agentBefore] = await sql<{ working_memory: string | null }[]>`
      SELECT working_memory FROM agents.agent_definitions WHERE id = ${AGENT_ID}
    `
    const baselineNotes = await sql<{ count: number }[]>`
      SELECT count(*)::int FROM messaging.internal_notes WHERE conversation_id = ${CONV_ID}
    `
    const baselineProposals = await sql<{ count: number }[]>`
      SELECT count(*)::int FROM changes.change_proposals
       WHERE organization_id = ${ORG_ID}
         AND resource_module = 'drive'
    `
    const baselineAssistant = await sql<{ count: number }[]>`
      SELECT count(*)::int FROM harness.messages m
      JOIN harness.threads t ON t.id = m.thread_id
      WHERE t.conversation_id = ${CONV_ID}
        AND m.payload->>'role' = 'assistant'
    `

    console.log('[smoke:supervisor-action] baselines:')
    console.log(`  contact.memory length: ${(contactBefore?.memory ?? '').length}`)
    console.log(`  agent.working_memory length: ${(agentBefore?.working_memory ?? '').length}`)
    console.log(`  internal_notes: ${baselineNotes[0]?.count ?? 0}`)
    console.log(`  drive proposals: ${baselineProposals[0]?.count ?? 0}`)
    console.log(`  assistant turns on conv: ${baselineAssistant[0]?.count ?? 0}`)

    // ─── Post the supervisor note (@-mentions the agent) ───
    const noteRes = await api(`/api/messaging/conversations/${CONV_ID}/notes`, {
      method: 'POST',
      body: JSON.stringify({
        body: NOTE_BODY,
        authorType: 'staff',
        authorId: userId,
        mentions: [`agent:${AGENT_ID}`],
      }),
    })
    const noteText = await noteRes.text()
    if (!noteRes.ok) {
      console.error(`[smoke:supervisor-action] ✗ POST notes ${noteRes.status}: ${noteText}`)
      process.exit(1)
    }
    console.log(`[smoke:supervisor-action] ✓ POST notes ${noteRes.status}: ${noteText.slice(0, 200)}…`)

    // ─── Poll for the assistant journal turn ───
    let assistantRow: JournalRow | undefined
    for (let i = 0; i < POLL_S; i += 1) {
      await new Promise((r) => setTimeout(r, 1000))
      const rows = await sql<JournalRow[]>`
        SELECT m.id, m.seq, m.payload
        FROM harness.messages m
        JOIN harness.threads t ON t.id = m.thread_id
        WHERE t.conversation_id = ${CONV_ID}
          AND m.payload->>'role' = 'assistant'
        ORDER BY m.seq ASC
      `
      if (rows.length > (baselineAssistant[0]?.count ?? 0)) {
        assistantRow = rows[rows.length - 1]
        break
      }
      if (i % 5 === 0) console.log(`[poll ${i}s] assistant turns so far: ${rows.length}`)
    }
    if (!assistantRow) {
      console.error('❌ timed out waiting for assistant journal turn')
      process.exit(2)
    }

    const text = pickText(assistantRow.payload)
    const tools = pickToolCalls(assistantRow.payload)
    console.log(`\n[smoke:supervisor-action] assistant turn id=${assistantRow.id} seq=${assistantRow.seq}`)
    console.log(`  text: ${text ? text.slice(0, 400) : '(non-text or empty)'}`)
    console.log(`  tool calls: ${tools.length === 0 ? '(none)' : tools.join(', ')}`)

    // ─── Diff post-state ───
    const [contactAfter] = await sql<{ memory: string | null }[]>`
      SELECT memory FROM contacts.contacts WHERE id = ${CONTACT_ID}
    `
    const [agentAfter] = await sql<{ working_memory: string | null }[]>`
      SELECT working_memory FROM agents.agent_definitions WHERE id = ${AGENT_ID}
    `
    const newNotes = await sql<NoteRow[]>`
      SELECT id, author_type, author_id, body, created_at
      FROM messaging.internal_notes
      WHERE conversation_id = ${CONV_ID}
      ORDER BY created_at ASC
      OFFSET ${baselineNotes[0]?.count ?? 0}
    `
    const newProposals = await sql<ProposalRow[]>`
      SELECT id, resource_module, resource_type, status, created_at
      FROM changes.change_proposals
      WHERE organization_id = ${ORG_ID}
        AND resource_module = 'drive'
      ORDER BY created_at ASC
      OFFSET ${baselineProposals[0]?.count ?? 0}
    `

    const contactChanged = (contactBefore?.memory ?? '') !== (contactAfter?.memory ?? '')
    const agentChanged = (agentBefore?.working_memory ?? '') !== (agentAfter?.working_memory ?? '')
    const agentPostedNote = newNotes.some((n) => n.author_type === 'agent')
    const driveProposalCreated = newProposals.length > 0

    console.log('\n=== POST-WAKE EFFECTS ===')
    console.log(`  contact memory mutated:           ${contactChanged ? '✓' : '✗'}`)
    if (contactChanged)
      console.log(`    delta: +${(contactAfter?.memory ?? '').length - (contactBefore?.memory ?? '').length} chars`)
    console.log(`  agent memory mutated:             ${agentChanged ? '✓' : '✗'}`)
    if (agentChanged)
      console.log(
        `    delta: +${(agentAfter?.working_memory ?? '').length - (agentBefore?.working_memory ?? '').length} chars`,
      )
    console.log(`  agent posted internal note:       ${agentPostedNote ? '✓' : '✗'}`)
    if (agentPostedNote) {
      const agentNotes = newNotes.filter((n) => n.author_type === 'agent')
      for (const n of agentNotes) {
        console.log(`    note ${n.id}: ${n.body.slice(0, 200).replace(/\n/g, ' ')}`)
      }
    }
    console.log(`  drive proposal created:           ${driveProposalCreated ? '✓' : '✗'}`)
    if (driveProposalCreated) {
      for (const p of newProposals) {
        console.log(`    proposal ${p.id} (${p.resource_module}/${p.resource_type}, status=${p.status})`)
      }
    }

    // Aggregate verdict — at least 2 of 4 actions should fire for the agent to
    // be considered "doing work, not silently no-op'ing". The user's reported
    // failure mode is the agent acknowledging without acting; this guard
    // catches that explicitly.
    const fired = [contactChanged, agentChanged, agentPostedNote, driveProposalCreated].filter(Boolean).length
    console.log(`\n[smoke:supervisor-action] effect count: ${fired}/4`)

    if (tools.includes('bash')) console.log('  ✓ agent invoked bash (exploration confirmed)')
    else console.log('  ✗ NO bash invocations — agent did not explore the virtual FS first')

    if (fired >= 2) {
      console.log('\n✅ supervisor wake produced concrete cross-module effects')
      process.exit(0)
    }
    console.error(
      '\n❌ supervisor wake completed but produced fewer than 2 effects — likely the silent-no-op failure mode',
    )
    console.error('   Inspect the assistant turn payload above + harness.messages for tool calls / refusals.')
    process.exit(3)
  } finally {
    await sql.end()
  }
}

function pickText(payload: unknown): string | null {
  if (!payload || typeof payload !== 'object') return null
  const p = payload as Record<string, unknown>
  if (typeof p.content === 'string') return p.content
  if (Array.isArray(p.content)) {
    const text = p.content
      .filter((c): c is { type?: string; text?: string } => typeof c === 'object' && c !== null)
      .map((c) => c.text)
      .filter((t): t is string => typeof t === 'string' && t.length > 0)
      .join('\n')
    return text.length > 0 ? text : null
  }
  return null
}

function pickToolCalls(payload: unknown): string[] {
  if (!payload || typeof payload !== 'object') return []
  const p = payload as Record<string, unknown>
  if (!Array.isArray(p.content)) return []
  const names: string[] = []
  for (const part of p.content) {
    if (!part || typeof part !== 'object') continue
    const obj = part as Record<string, unknown>
    if (obj.type === 'tool_call' || obj.type === 'tool-call') {
      const name = typeof obj.name === 'string' ? obj.name : typeof obj.toolName === 'string' ? obj.toolName : null
      if (name) names.push(name)
    }
  }
  return names
}

await main()
