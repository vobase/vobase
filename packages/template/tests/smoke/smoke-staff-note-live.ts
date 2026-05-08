#!/usr/bin/env bun
/**
 * Live smoke for the staff-note wake → tool-using agent flow.
 *
 * Reproduces the manual-test path that has historically been flaky:
 *   1. Staff `@-mention`s the assigned agent in a seeded conversation's
 *      internal note, asking it to do three concrete things at once:
 *        a. update the contact's MEMORY.md with a fact
 *        b. update its own (agent) MEMORY.md with a rule
 *        c. propose a change to /drive/BUSINESS.md (or ask back if uncertain)
 *   2. The staff-note fan-out enqueues `messaging:staff-note-to-wake`.
 *   3. The wake handler boots the conversation-lane agent.
 *   4. Agent should explore (`cat`/`grep` virtual files), reason, and act.
 *
 * Asserts (all non-fatal — prints a diagnostic table so the failure mode is
 * visible even when the agent does only some of the actions):
 *   - assistant journal turn lands within POLL_S seconds
 *   - bash invocations exist (the agent EXPLORED before acting)
 *   - effects: at least 2 of {contact memory mutated, agent memory mutated,
 *     drive proposal created, agent posted an internal note} fired
 *
 * Tunable env: CONV_ID, AGENT_ID, AGENT_HANDLE, CONTACT_ID, POLL_S.
 */

import { devLogin, makeAuthedFetch } from './_helpers'
import {
  POLL_S_DEFAULTS,
  connectSmokeDb,
  countAssistantTurns,
  envPollS,
  pickText,
  pickToolCalls,
  pollAssistantTurns,
  runSmoke,
  SMOKE_AGENT_ID,
} from '../helpers/smoke-runtime'

const ORG_ID = process.env.ORG_ID ?? 'mer0tenant'
const CONV_ID = process.env.CONV_ID ?? 'cnv0marcus'
const AGENT_ID = process.env.AGENT_ID ?? SMOKE_AGENT_ID
const AGENT_HANDLE = process.env.AGENT_HANDLE ?? 'MeriGPT'
const CONTACT_ID = process.env.CONTACT_ID ?? 'ctt0marcus'
const EMAIL = process.env.SMOKE_EMAIL ?? 'alice@meridian.test'
const POLL_S = envPollS(POLL_S_DEFAULTS.staffNote)

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

await runSmoke(
  'staff-note',
  async ({ baseUrl }) => {
    console.log(`[smoke:staff-note] conv=${CONV_ID} agent=${AGENT_ID}@${AGENT_HANDLE}`)
    const auth = await devLogin(baseUrl, EMAIL)
    const api = makeAuthedFetch(baseUrl, auth)
    const { sql, end } = connectSmokeDb()
    try {
      // Pre-state baselines.
      const [contactBefore] = await sql<{ memory: string | null }[]>`
        SELECT memory FROM contacts.contacts WHERE id = ${CONTACT_ID}
      `
      const [agentBefore] = await sql<{ working_memory: string | null }[]>`
        SELECT working_memory FROM agents.agent_definitions WHERE id = ${AGENT_ID}
      `
      const baselineNotes = await sql<{ count: number }[]>`
        SELECT count(*)::int AS count FROM messaging.internal_notes WHERE conversation_id = ${CONV_ID}
      `
      const baselineProposals = await sql<{ count: number }[]>`
        SELECT count(*)::int AS count FROM changes.change_proposals
        WHERE organization_id = ${ORG_ID} AND resource_module = 'drive'
      `
      const baselineAssistant = await countAssistantTurns(sql, CONV_ID)

      console.log('[smoke:staff-note] baselines:')
      console.log(`  contact.memory: ${(contactBefore?.memory ?? '').length} chars`)
      console.log(`  agent.working_memory: ${(agentBefore?.working_memory ?? '').length} chars`)
      console.log(`  internal_notes: ${baselineNotes[0]?.count ?? 0}`)
      console.log(`  drive proposals: ${baselineProposals[0]?.count ?? 0}`)
      console.log(`  assistant turns on conv: ${baselineAssistant}`)

      // Post the note (@-mentions the agent → fan-out to staff-note wake).
      const noteRes = await api(`/api/messaging/conversations/${CONV_ID}/notes`, {
        method: 'POST',
        body: JSON.stringify({
          body: NOTE_BODY,
          authorType: 'staff',
          authorId: auth.userId,
          mentions: [`agent:${AGENT_ID}`],
        }),
      })
      const noteText = await noteRes.text()
      if (!noteRes.ok) throw new Error(`POST notes ${noteRes.status}: ${noteText}`)
      console.log(`[smoke:staff-note] ✓ POST notes ${noteRes.status}: ${noteText.slice(0, 200)}…`)

      const turns = await pollAssistantTurns({
        sql,
        conversationId: CONV_ID,
        baseline: baselineAssistant,
        timeoutS: POLL_S,
        label: '[smoke:staff-note]',
      })
      const assistantRow = turns[turns.length - 1]
      if (!assistantRow) throw new Error('pollAssistantTurns returned empty array')

      const text = pickText(assistantRow.payload)
      const calls = pickToolCalls(assistantRow.payload)
      console.log(`\n[smoke:staff-note] assistant turn id=${assistantRow.id} seq=${assistantRow.seq}`)
      console.log(`  text: ${text ? text.slice(0, 400) : '(non-text or empty)'}`)
      console.log(`  tool calls: ${calls.length === 0 ? '(none)' : calls.map((c) => c.name).join(', ')}`)

      // Diff post-state.
      const [contactAfter] = await sql<{ memory: string | null }[]>`
        SELECT memory FROM contacts.contacts WHERE id = ${CONTACT_ID}
      `
      const [agentAfter] = await sql<{ working_memory: string | null }[]>`
        SELECT working_memory FROM agents.agent_definitions WHERE id = ${AGENT_ID}
      `
      const newNotes = await sql<{ id: string; author_type: string; body: string }[]>`
        SELECT id, author_type, body FROM messaging.internal_notes
        WHERE conversation_id = ${CONV_ID}
        ORDER BY created_at ASC
        OFFSET ${baselineNotes[0]?.count ?? 0}
      `
      const newProposals = await sql<{ id: string; resource_module: string; resource_type: string; status: string }[]>`
        SELECT id, resource_module, resource_type, status FROM changes.change_proposals
        WHERE organization_id = ${ORG_ID} AND resource_module = 'drive'
        ORDER BY created_at ASC
        OFFSET ${baselineProposals[0]?.count ?? 0}
      `

      const contactChanged = (contactBefore?.memory ?? '') !== (contactAfter?.memory ?? '')
      const agentChanged = (agentBefore?.working_memory ?? '') !== (agentAfter?.working_memory ?? '')
      const agentPostedNote = newNotes.some((n) => n.author_type === 'agent')
      const driveProposalCreated = newProposals.length > 0

      console.log('\n=== POST-WAKE EFFECTS ===')
      console.log(`  contact memory mutated:           ${contactChanged ? '✓' : '✗'}`)
      console.log(`  agent memory mutated:             ${agentChanged ? '✓' : '✗'}`)
      console.log(`  agent posted internal note:       ${agentPostedNote ? '✓' : '✗'}`)
      if (agentPostedNote) {
        for (const n of newNotes.filter((n) => n.author_type === 'agent')) {
          console.log(`    note ${n.id}: ${n.body.slice(0, 200).replace(/\n/g, ' ')}`)
        }
      }
      console.log(`  drive proposal created:           ${driveProposalCreated ? '✓' : '✗'}`)
      for (const p of newProposals) {
        console.log(`    proposal ${p.id} (${p.resource_module}/${p.resource_type}, status=${p.status})`)
      }

      const fired = [contactChanged, agentChanged, agentPostedNote, driveProposalCreated].filter(Boolean).length
      console.log(`\n[smoke:staff-note] effect count: ${fired}/4`)
      if (calls.some((c) => c.name === 'bash')) console.log('  ✓ agent invoked bash (exploration confirmed)')
      else console.log('  ✗ NO bash invocations — agent did not explore the virtual FS first')

      if (fired < 2) {
        throw new Error(`only ${fired}/4 effects fired — likely silent-no-op`)
      }
      console.log('\n[smoke:staff-note] ✓ produced concrete cross-module effects')
    } finally {
      await end()
    }
  },
  { dumpOnFailure: () => [CONV_ID] },
)
