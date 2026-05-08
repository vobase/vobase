#!/usr/bin/env bun

/**
 * Realistic-persona smoke. Same matrix as `smoke-learning-loop-live.ts` but
 * with messages rewritten to test what actually happens in the wild:
 *
 *   - Customers are short, casual, often misspelled, business-illiterate
 *     ("hi can i change my plan", not "I want to migrate from Pro to Team").
 *     They don't know product names, internal jargon, or staff identities.
 *
 *   - Staff are terse, business-aware, and demand efficiency. They drop
 *     coaching notes in shorthand ("pro→team = 24h cooldown, mention it"),
 *     not in coherent sentences. They expect the agent to fill in gaps.
 *
 * For every scenario this script ALSO dumps the full conversation state on
 * pass or fail (transcript + journal events + tool calls with arguments +
 * proposals + change events), so the LLM behaviour is inspectable end-to-end.
 *
 * Usage: `bun run tests/smoke/smoke-realistic-personas-live.ts [scenario|all]`
 */

import {
  ALICE_USER_ID,
  candidateCounts,
  close,
  decide,
  injectEcho,
  insertPending,
  listCandidates,
  listProposals,
  open,
  printCandidates,
  readAgentMemory,
  readContactMemory,
  readStaffMemory,
  type SmokeCtx,
  sendInbound,
  staffNote,
  staffReply,
  waitForReply,
} from '../helpers/learning-smoke'
import { connectSmokeDb, dumpConversationState } from '../helpers/smoke-runtime'

const BASE_URL = process.env.BASE_URL ?? 'http://localhost:3000'
const POLL_S = Number(process.env.POLL_S ?? 180)

interface ScenarioResult {
  name: string
  ok: boolean
  details: string
  conversationIds: string[]
  notes: string[]
}

const trackedConvs = new Set<string>()
function track(id: string): string {
  trackedConvs.add(id)
  return id
}

async function pollFor<T>(fn: () => Promise<T>, pred: (v: T) => boolean, timeoutS: number): Promise<T | null> {
  for (let i = 0; i < timeoutS; i++) {
    const v = await fn()
    if (pred(v)) return v
    await new Promise((r) => setTimeout(r, 1000))
  }
  return null
}

async function replyCount(ctx: SmokeCtx, conversationId: string): Promise<number> {
  const rows = await ctx.sql<{ n: number }[]>`
    SELECT count(*)::int AS n FROM messaging.messages WHERE conversation_id = ${conversationId} AND role = 'agent'
  `
  return rows[0]?.n ?? 0
}

// ─── Scenarios ───────────────────────────────────────────────────────────────

/** Customer asks about a plan change in casual language; staff drops a terse
 *  coaching shorthand; agent should pick up the lesson on the next turn. */
async function takeoverScenario(ctx: SmokeCtx): Promise<ScenarioResult> {
  const notes: string[] = []
  // Realistic customer: short, vague, no plan tier names.
  const { conversationId } = await sendInbound(ctx, 'hey can i change my plan? need more seats for the team')
  track(conversationId)
  await waitForReply(ctx, conversationId, 0, { timeoutS: POLL_S, quiet: true })
  notes.push('agent replied to opener')

  // Realistic staff: terse, drops verb articles, demands compliance.
  await staffReply(
    ctx,
    conversationId,
    'pro→team upgrade has 24h billing cooldown. mention it. linear/jira need manual reauth after switch — flag that too',
  )
  notes.push('staff takeover posted (terse)')

  const candidate = await pollFor(
    () => listCandidates(ctx, { conversationId, signalKind: 'staff_takeover', status: 'pending' }),
    (rows) => rows.length > 0,
    20,
  )
  if (!candidate || candidate.length === 0)
    return {
      name: 'takeover',
      ok: false,
      details: 'no staff_takeover candidate within 20s',
      conversationIds: [conversationId],
      notes,
    }
  notes.push(`candidate landed: conf=${candidate[0]?.triageConfidence}`)

  const before = await replyCount(ctx, conversationId)
  // Customer follow-up that's mechanical/boring — should still pull the lesson.
  await sendInbound(ctx, 'oh ok and my coworker wants to upgrade too next week. anything i should tell him?')
  await waitForReply(ctx, conversationId, before, { timeoutS: POLL_S, quiet: true })

  const consumed = (await listCandidates(ctx, { conversationId })).find(
    (c) => c.signalKind === 'staff_takeover' && c.status === 'consumed',
  )
  const proposals = await listProposals(ctx, conversationId)
  const memProposal = proposals.find((p) => p.id === consumed?.consumedByProposalId)
  const memory = await readAgentMemory(ctx)
  const tail = memory.slice(-2000)
  const memoryHit = /cooldown|24h|reauth|linear|jira/i.test(tail)

  notes.push(`consumed=${!!consumed} proposal=${memProposal?.id ?? 'none'} memoryHit=${memoryHit}`)
  return {
    name: 'takeover',
    ok: !!consumed && memoryHit,
    details: `consumed=${!!consumed} memoryHit=${memoryHit}`,
    conversationIds: [conversationId],
    notes,
  }
}

/** Customer asks about weekend hours casually; staff coaching note (no @) is
 *  short and unverbose. */
async function noteScenario(ctx: SmokeCtx): Promise<ScenarioResult> {
  const notes: string[] = []
  const { conversationId } = await sendInbound(ctx, 'do u guys work weekends? need help sunday')
  track(conversationId)
  await waitForReply(ctx, conversationId, 0, { timeoutS: POLL_S, quiet: true })
  notes.push('agent replied to weekend question')

  await staffNote(ctx, conversationId, 'weekends = on-call only, prod incidents only. push non-urgent stuff to monday')
  notes.push('staff coaching note posted (no @)')

  const cands = await pollFor(
    () => listCandidates(ctx, { conversationId, signalKind: 'coaching_note', status: 'pending' }),
    (r) => r.length > 0,
    20,
  )
  if (!cands || cands.length === 0)
    return {
      name: 'note',
      ok: false,
      details: 'no coaching_note candidate within 20s',
      conversationIds: [conversationId],
      notes,
    }
  notes.push(`candidate landed: conf=${cands[0]?.triageConfidence}`)

  const before = await replyCount(ctx, conversationId)
  // Casual customer follow-up testing the lesson.
  await sendInbound(ctx, 'k but if i get a billing problem sunday is that ok')
  await waitForReply(ctx, conversationId, before, { timeoutS: POLL_S, quiet: true })

  const updated = (await listCandidates(ctx, { conversationId })).find(
    (c) => c.signalKind === 'coaching_note' && c.status !== 'pending',
  )
  notes.push(`final candidate status=${updated?.status ?? 'still pending'}`)
  return {
    name: 'note',
    ok: !!updated,
    details: updated ? `coaching_note → ${updated.status}` : 'still pending',
    conversationIds: [conversationId],
    notes,
  }
}

/** Mention of a staff member in the note — different fan-out path. */
async function mentionNoteScenario(ctx: SmokeCtx): Promise<ScenarioResult> {
  const notes: string[] = []
  const { conversationId } = await sendInbound(ctx, 'hi - i think i was charged twice this morning. can someone check?')
  track(conversationId)
  await waitForReply(ctx, conversationId, 0, { timeoutS: POLL_S, quiet: true })
  notes.push('opener replied')

  // @-mention staff: per the wake harness, mentioned notes trigger a
  // staff_note wake (not triage). Verifies the mention path doesn't double-fire.
  await staffNote(
    ctx,
    conversationId,
    `@MeriGPT pull stripe charge ids and last-4. don't refund yet, ping ${ALICE_USER_ID}`,
    { mentions: [ALICE_USER_ID] },
  )
  notes.push('mention note posted')

  // Wait for the staff_note wake to fire — short sleep covers the typical
  // dispatch + LLM round-trip; the events query below tolerates partial state.
  await new Promise((r) => setTimeout(r, 5000))
  const events = await ctx.sql<{ type: string; tool_name: string | null }[]>`
    SELECT type, tool_name FROM harness.conversation_events
    WHERE conversation_id = ${conversationId}
    ORDER BY ts ASC
  `
  const sawStaffNoteWake = events.some(
    (e) => e.type === 'agent_start' || e.type === 'wake_start' || e.type === 'wake_started',
  )
  notes.push(
    `saw wake events: ${events
      .map((e) => e.type)
      .slice(0, 6)
      .join(',')}`,
  )

  // Coaching candidates should NOT exist for mention notes (they go to wake, not triage).
  const triageRows = await listCandidates(ctx, { conversationId, signalKind: 'coaching_note' })
  notes.push(`triage candidates from mention note: ${triageRows.length} (should be 0)`)

  return {
    name: 'mention-note',
    ok: triageRows.length === 0 && sawStaffNoteWake,
    details: `mention bypassed triage=${triageRows.length === 0}, wake_fired=${sawStaffNoteWake}`,
    conversationIds: [conversationId],
    notes,
  }
}

/** Customer asks for something where rejection of past phone proposal applies.
 *  Opener avoids field-update shapes so the agent doesn't pre-create a colliding
 *  contacts.contact pending proposal (uniq_change_proposals_pending_target). */
async function rejectionScenario(ctx: SmokeCtx): Promise<ScenarioResult> {
  const notes: string[] = []
  const { conversationId, contactId } = await sendInbound(
    ctx,
    'hey just saying hi, no specific question yet, just wanted to test the chat',
  )
  track(conversationId)
  await waitForReply(ctx, conversationId, 0, { timeoutS: POLL_S, quiet: true })
  notes.push('opener replied (no field-update shape)')

  // Plant a pending proposal masquerading as agent-authored, reject with substantive note.
  const pid = await insertPending(ctx, {
    conversationId,
    contactId,
    field: 'phone',
    value: '+15555550199',
    rationale: 'caught a 555 number',
  })
  await decide(
    ctx,
    pid,
    'rejected',
    'never accept 555-prefix numbers — those are reserved for fiction. confirm a real number with country code first',
  )
  notes.push(`planted+rejected proposal ${pid}`)

  const cands = await pollFor(
    () => listCandidates(ctx, { conversationId, signalKind: 'rejection', status: 'pending' }),
    (r) => r.length > 0,
    20,
  )
  if (!cands || cands.length === 0)
    return {
      name: 'rejection',
      ok: false,
      details: 'no rejection candidate within 20s',
      conversationIds: [conversationId],
      notes,
    }
  notes.push(`rejection candidate landed`)

  const before = await replyCount(ctx, conversationId)
  // Customer asks for exactly the forbidden thing in casual language.
  await sendInbound(ctx, 'btw new number is 555-555-0199, thats the one to use')
  await waitForReply(ctx, conversationId, before, { timeoutS: POLL_S, quiet: true })

  const final = (await listCandidates(ctx, { conversationId })).find((c) => c.signalKind === 'rejection')
  notes.push(`final status=${final?.status}`)
  if (!final)
    return {
      name: 'rejection',
      ok: false,
      details: 'rejection candidate disappeared',
      conversationIds: [conversationId],
      notes,
    }
  return {
    name: 'rejection',
    ok: final.status !== 'pending',
    details: `rejection → ${final.status}`,
    conversationIds: [conversationId],
    notes,
  }
}

/** Coexistence echo: a staff-mirrored channel reply containing a policy. */
async function echoScenario(ctx: SmokeCtx): Promise<ScenarioResult> {
  const notes: string[] = []
  const seed = await sendInbound(ctx, 'hi got a question about my last order')
  track(seed.conversationId)
  await waitForReply(ctx, seed.conversationId, 0, { timeoutS: POLL_S, quiet: true })
  notes.push('opener replied')

  // Realistic staff SMS shorthand — short, declarative, action-oriented.
  const echo = await injectEcho(
    ctx,
    ctx.from,
    '[Carol via SMS] heads up — refund SMS confirmations need to include card last-4 from now on. customers were confused last month bc only had order id. always mention last-4',
  )
  if (echo.conversationId !== seed.conversationId) {
    return {
      name: 'echo',
      ok: false,
      details: `echo landed on different conv (${echo.conversationId} vs ${seed.conversationId})`,
      conversationIds: [seed.conversationId, echo.conversationId],
      notes,
    }
  }
  notes.push('echo injected on same conv')

  const cands = await pollFor(
    () =>
      listCandidates(ctx, { conversationId: echo.conversationId, signalKind: 'coexistence_echo', status: 'pending' }),
    (rows) => rows.length > 0,
    20,
  )
  if (!cands || cands.length === 0)
    return {
      name: 'echo',
      ok: false,
      details: 'no coexistence_echo candidate within 20s',
      conversationIds: [echo.conversationId],
      notes,
    }
  notes.push(`echo candidate landed`)

  const before = await replyCount(ctx, echo.conversationId)
  await sendInbound(ctx, 'oh and pls remember i prefer sms not email for billing')
  await waitForReply(ctx, echo.conversationId, before, { timeoutS: POLL_S, quiet: true })

  const final = (await listCandidates(ctx, { conversationId: echo.conversationId })).find(
    (c) => c.signalKind === 'coexistence_echo',
  )
  notes.push(`final status=${final?.status ?? 'gone'}`)
  return {
    name: 'echo',
    ok: !!final,
    details: `echo candidate status=${final?.status ?? 'gone'} (landed=${cands.length})`,
    conversationIds: [echo.conversationId],
    notes,
  }
}

/** Trivial-bland staff praise — should drop. */
async function trivialScenario(ctx: SmokeCtx): Promise<ScenarioResult> {
  const { conversationId } = await sendInbound(ctx, 'hi when do u open today')
  track(conversationId)
  await waitForReply(ctx, conversationId, 0, { timeoutS: POLL_S, quiet: true })

  await staffNote(ctx, conversationId, 'nice')
  await staffNote(ctx, conversationId, 'gj')

  await new Promise((r) => setTimeout(r, 8000))
  const cands = await listCandidates(ctx, {
    conversationId,
    signalKind: 'coaching_note',
    status: 'pending',
  })
  return {
    name: 'trivial',
    ok: cands.length === 0,
    details: cands.length === 0 ? 'bland notes correctly dropped' : `${cands.length} leaked through`,
    conversationIds: [conversationId],
    notes: [`pending bland candidates: ${cands.length}`],
  }
}

/** Customer mentions a personal preference; staff says save it to the contact memory. */
async function contactMemoryScenario(ctx: SmokeCtx): Promise<ScenarioResult> {
  const notes: string[] = []
  const seed = await sendInbound(
    ctx,
    'hey - pls text me for billing stuff but email everything else, my phone is loud at work',
  )
  track(seed.conversationId)
  await waitForReply(ctx, seed.conversationId, 0, { timeoutS: POLL_S, quiet: true })
  notes.push('opener replied')

  await staffNote(
    ctx,
    seed.conversationId,
    'save to contact memory: SMS for billing, email for all else. respect across threads',
  )
  notes.push('coaching note (contact-memory shaped)')

  const cands = await pollFor(
    () => listCandidates(ctx, { conversationId: seed.conversationId, signalKind: 'coaching_note', status: 'pending' }),
    (rows) => rows.length > 0,
    25,
  )
  if (!cands || cands.length === 0)
    return {
      name: 'contact-memory',
      ok: false,
      details: 'no coaching_note candidate within 25s',
      conversationIds: [seed.conversationId],
      notes,
    }
  notes.push(`scope hint: ${cands[0]?.scopeHint}`)

  if (!cands.some((c) => c.scopeHint === 'contacts.contact_memory')) {
    return {
      name: 'contact-memory',
      ok: false,
      details: `wrong scope hint (got ${cands.map((c) => c.scopeHint).join('|')})`,
      conversationIds: [seed.conversationId],
      notes,
    }
  }

  const before = await replyCount(ctx, seed.conversationId)
  await sendInbound(ctx, 'ah - does the sms thing also apply to refunds')
  await waitForReply(ctx, seed.conversationId, before, { timeoutS: POLL_S, quiet: true })

  const memory = await readContactMemory(ctx, seed.contactId)
  const proposals = await listProposals(ctx, seed.conversationId)
  const memProposal = proposals.find((p) => p.resourceModule === 'contacts' && p.resourceType === 'contact_memory')

  if (!memProposal)
    return {
      name: 'contact-memory',
      ok: false,
      details: 'no contact_memory proposal — agent did not consume',
      conversationIds: [seed.conversationId],
      notes,
    }
  const ok = /sms|billing/i.test(memory)
  notes.push(`proposal=${memProposal.id} status=${memProposal.status} memoryHit=${ok}`)
  return {
    name: 'contact-memory',
    ok,
    details: `proposal ${memProposal.status}; memory mentions sms/billing=${ok}`,
    conversationIds: [seed.conversationId],
    notes,
  }
}

/** Staff-memory scope: per-(agent, staff) preference. */
async function staffMemoryScenario(ctx: SmokeCtx): Promise<ScenarioResult> {
  const notes: string[] = []
  const seed = await sendInbound(ctx, 'hi - $42 charge on my card i dont recognise. can u check')
  track(seed.conversationId)
  await waitForReply(ctx, seed.conversationId, 0, { timeoutS: POLL_S, quiet: true })

  await staffNote(
    ctx,
    seed.conversationId,
    `note for MeriGPT: when paging Alice (${ALICE_USER_ID}) about refunds always include stripe charge id + card last-4. she won't act without. save to staff memory for Alice`,
  )
  notes.push('staff-memory shaped note')

  const cands = await pollFor(
    () => listCandidates(ctx, { conversationId: seed.conversationId, signalKind: 'coaching_note', status: 'pending' }),
    (rows) => rows.length > 0,
    25,
  )
  if (!cands || cands.length === 0)
    return {
      name: 'staff-memory',
      ok: false,
      details: 'no coaching_note candidate within 25s',
      conversationIds: [seed.conversationId],
      notes,
    }
  notes.push(`scope=${cands[0]?.scopeHint}`)

  const before = await replyCount(ctx, seed.conversationId)
  await sendInbound(ctx, 'name is vance. can u flag this to alice')
  await waitForReply(ctx, seed.conversationId, before, { timeoutS: POLL_S, quiet: true })

  const proposals = await listProposals(ctx, seed.conversationId)
  const staffProp = proposals.find((p) => p.resourceModule === 'team' && p.resourceType === 'staff_memory')
  if (!staffProp)
    return {
      name: 'staff-memory',
      ok: false,
      details: 'no staff_memory proposal — agent picked wrong scope',
      conversationIds: [seed.conversationId],
      notes,
    }

  const stored = await readStaffMemory(ctx, ALICE_USER_ID)
  const ok = /stripe|charge|last-4/i.test(stored)
  notes.push(`proposal ${staffProp.id} status=${staffProp.status}; staff memory hit=${ok}`)
  return {
    name: 'staff-memory',
    ok,
    details: `proposal ${staffProp.status}; staff memory mentions stripe/charge/last-4=${ok}`,
    conversationIds: [seed.conversationId],
    notes,
  }
}

/** Skill: terse staff coaching becomes a permanent learned skill, replayed
 *  in a new conversation. */
async function learnedSkillScenario(ctx: SmokeCtx): Promise<ScenarioResult> {
  const notes: string[] = []
  const conv1 = await sendInbound(ctx, 'do u have a referral thing? thinking of inviting my coworker')
  track(conv1.conversationId)
  await waitForReply(ctx, conv1.conversationId, 0, { timeoutS: POLL_S, quiet: true })
  notes.push('opener replied')

  await staffNote(
    ctx,
    conv1.conversationId,
    'capture as learned_skill `redeem-promo`: (1) check code active in settings → billing → promotions (2) tell customer discount on next invoice not retroactive (3) stacks w/ annual discount. permanent skill',
  )
  notes.push('skill-shaped coaching note')

  const cands = await pollFor(
    () => listCandidates(ctx, { conversationId: conv1.conversationId, signalKind: 'coaching_note', status: 'pending' }),
    (rows) => rows.length > 0,
    25,
  )
  if (!cands || cands.length === 0)
    return {
      name: 'learned-skill',
      ok: false,
      details: 'no candidate within 25s',
      conversationIds: [conv1.conversationId],
      notes,
    }

  const before = await replyCount(ctx, conv1.conversationId)
  // Customer follow-up that triggers the skill — casual, broken sentence.
  await sendInbound(ctx, 'oh wait my friend gave me her code REF-2026, how do i use it? i renew annually next month')
  await waitForReply(ctx, conv1.conversationId, before, { timeoutS: POLL_S, quiet: true })

  const proposals = await listProposals(ctx, conv1.conversationId)
  const skillProp = proposals.find((p) => p.resourceModule === 'agents' && p.resourceType === 'learned_skill')
  if (!skillProp)
    return {
      name: 'learned-skill',
      ok: false,
      details: 'no learned_skill proposal',
      conversationIds: [conv1.conversationId],
      notes,
    }
  notes.push(`skill proposal ${skillProp.id} status=${skillProp.status}`)

  if (skillProp.status === 'pending') {
    await decide(ctx, skillProp.id, 'approved', 'smoke approval — capture redeem-promo')
    notes.push('manually approved')
  }

  const skillRows = await ctx.sql<{ id: string; name: string; body: string; agent_id: string | null }[]>`
    SELECT id, name, body, agent_id FROM agents.learned_skills WHERE parent_proposal_id = ${skillProp.id}
  `
  if (skillRows.length === 0)
    return {
      name: 'learned-skill',
      ok: false,
      details: `proposal ${skillProp.status} did not materialize`,
      conversationIds: [conv1.conversationId],
      notes,
    }
  const skill = skillRows[0]
  if (!skill)
    return {
      name: 'learned-skill',
      ok: false,
      details: 'skill row vanished',
      conversationIds: [conv1.conversationId],
      notes,
    }
  notes.push(`skill ${skill.name} (id=${skill.id})`)

  // Replay with a NEW customer in a new conversation.
  const ctx2 = await open({ from: `smoke-skill-realistic-${Date.now()}`, baseUrl: BASE_URL })
  try {
    const conv2 = await sendInbound(ctx2, 'hi! got a referral code SPRING25, how do i redeem')
    track(conv2.conversationId)
    const reply2 = await waitForReply(ctx2, conv2.conversationId, 0, { timeoutS: POLL_S, quiet: true })

    const tr = await ctx2.sql<{ body: string }[]>`
      SELECT
        COALESCE(
          m.payload->'content'->0->'arguments'->>'command',
          m.payload->'content'->0->>'text'
        ) AS body
      FROM harness.messages m
      JOIN harness.threads t ON t.id = m.thread_id
      WHERE t.conversation_id = ${conv2.conversationId}
    `
    const sawSkillRead = tr.some((r) => (r.body ?? '').includes('skills/') && (r.body ?? '').includes('redeem'))
    const replyMentions = /next invoice|not retroactive|stack|promotion|settings/i.test(reply2.text)

    notes.push(`bash-saw-skill=${sawSkillRead} reply-applies=${replyMentions}`)
    return {
      name: 'learned-skill',
      ok: sawSkillRead || replyMentions,
      details: `skill ${skill.name}; bash-saw=${sawSkillRead}; reply-applies=${replyMentions}`,
      conversationIds: [conv1.conversationId, conv2.conversationId],
      notes,
    }
  } finally {
    await close(ctx2)
  }
}

/** Default behaviour: agent uses send_card when there's structure (multiple
 *  options to pick from). */
async function cardScenario(ctx: SmokeCtx): Promise<ScenarioResult> {
  const notes: string[] = []
  // Question with multiple distinct options — agent should send a card with buttons.
  const { conversationId } = await sendInbound(
    ctx,
    'whats the difference between your plans? which one for a 5 person team',
  )
  track(conversationId)
  const reply = await waitForReply(ctx, conversationId, 0, { timeoutS: POLL_S, quiet: true })
  notes.push(`reply text length=${reply.text.length}`)

  // Wait for the wake to fully end (agent_end event) so we don't race against
  // the harness still writing tool dispatches. Polls conversation_events which
  // is journaled synchronously inside the wake transaction.
  for (let i = 0; i < 30; i++) {
    const ended = await ctx.sql<{ n: number }[]>`
      SELECT count(*)::int AS n FROM harness.conversation_events
      WHERE conversation_id = ${conversationId} AND type = 'agent_end'
    `
    if ((ended[0]?.n ?? 0) > 0) break
    await new Promise((r) => setTimeout(r, 1000))
  }

  // Inspect every tool dispatch the harness journaled for this conversation —
  // conversation_events.tool_name is set on tool_dispatch_started rows and is
  // the authoritative record (the harness.messages payload may lag).
  const tools = await ctx.sql<{ tool_name: string }[]>`
    SELECT DISTINCT tool_name FROM harness.conversation_events
    WHERE conversation_id = ${conversationId}
      AND type = 'tool_dispatch_started'
      AND tool_name IS NOT NULL
  `
  const toolNames = tools.map((t) => t.tool_name)
  notes.push(`tools used: ${toolNames.join(',') || '(none)'}`)
  const usedCard = toolNames.some((n) => /card|reply_with_card|send_card|message_card/i.test(n))
  return {
    name: 'card',
    ok: usedCard,
    details: usedCard ? 'send_card used for multi-option question' : `no card; tools=${toolNames.join(',')}`,
    conversationIds: [conversationId],
    notes,
  }
}

// ─── Runner ──────────────────────────────────────────────────────────────────

async function withCtx<T>(suffix: string, fn: (ctx: SmokeCtx) => Promise<T>): Promise<T> {
  const ctx = await open({ from: `smoke-real-${suffix}-${Date.now()}`, baseUrl: BASE_URL })
  try {
    return await fn(ctx)
  } finally {
    await close(ctx)
  }
}

const SCENARIOS: Record<string, () => Promise<ScenarioResult>> = {
  card: () => withCtx('card', cardScenario),
  takeover: () => withCtx('takeover', takeoverScenario),
  note: () => withCtx('note', noteScenario),
  'mention-note': () => withCtx('mention', mentionNoteScenario),
  rejection: () => withCtx('rejection', rejectionScenario),
  echo: () => withCtx('echo', echoScenario),
  'contact-memory': () => withCtx('contactmem', contactMemoryScenario),
  'staff-memory': () => withCtx('staffmem', staffMemoryScenario),
  'learned-skill': () => withCtx('skill', learnedSkillScenario),
  trivial: () => withCtx('trivial', trivialScenario),
}

async function dumpAll(ids: string[]): Promise<void> {
  if (ids.length === 0) return
  const handle = connectSmokeDb()
  try {
    for (const id of ids) {
      await dumpConversationState(handle.sql, id, { messagesLimit: 30 })
    }
  } finally {
    await handle.end()
  }
}

async function main(): Promise<void> {
  const requested = process.argv[2] ?? 'all'
  const names = requested === 'all' ? Object.keys(SCENARIOS) : [requested]

  const results: ScenarioResult[] = []
  for (const name of names) {
    const fn = SCENARIOS[name]
    if (!fn) {
      console.error(`unknown scenario: ${name} (valid: ${Object.keys(SCENARIOS).join(', ')}, all)`)
      process.exit(1)
    }
    console.log(`\n========== ${name} ==========`)
    try {
      const r = await fn()
      results.push(r)
      console.log(`[${r.ok ? 'OK' : '✗'}] ${r.name} — ${r.details}`)
      for (const note of r.notes) console.log(`  · ${note}`)
    } catch (err) {
      const r: ScenarioResult = {
        name,
        ok: false,
        details: `threw: ${(err as Error).message}`,
        conversationIds: [],
        notes: [],
      }
      results.push(r)
      console.error(`[✗] ${name} threw:`, err)
    }
  }

  // Always dump every tracked conversation — pass or fail. The whole point is
  // to make LLM behaviour inspectable.
  console.log(`\n========== conversation dumps (${trackedConvs.size}) ==========`)
  await dumpAll([...trackedConvs])

  await withCtx('summary', async (ctx) => {
    const counts = await candidateCounts(ctx)
    console.log('\n========== summary ==========')
    console.log(`status counts (org-wide): ${JSON.stringify(counts)}`)
    const allPending = await listCandidates(ctx, { status: 'pending', limit: 30 })
    console.log(`pending candidates (${allPending.length}):`)
    printCandidates(allPending)

    const allProps = await ctx.sql<
      { id: string; rm: string; rt: string; rid: string; status: string; conf: number | null }[]
    >`
      SELECT id, resource_module AS rm, resource_type AS rt, resource_id AS rid, status, confidence AS conf
      FROM changes.change_proposals
      WHERE organization_id = ${ctx.organizationId}
      ORDER BY created_at DESC
      LIMIT 40
    `
    console.log(`recent proposals (${allProps.length}):`)
    for (const p of allProps) {
      const c = p.conf != null ? `${(p.conf * 100).toFixed(0)}%` : ' n/a'
      console.log(`  [${p.status}] ${p.id} ${p.rm}.${p.rt}#${p.rid} conf=${c}`)
    }
  })

  const failures = results.filter((r) => !r.ok)
  console.log('\n========== verdict ==========')
  for (const r of results) console.log(`  [${r.ok ? 'OK' : '✗'}] ${r.name}`)
  if (failures.length > 0) {
    console.error(`\n${failures.length}/${results.length} scenario(s) failed`)
    process.exit(2)
  }
  console.log(`\nall ${results.length} scenario(s) passed`)
}

await main()
