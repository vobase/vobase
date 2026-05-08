#!/usr/bin/env bun

/**
 * Live learning-loop smoke. Drives realistic conversations through the agent
 * and asserts each signal source produces (or correctly drops) learning
 * candidates, the agent surfaces them on the next wake, and sensitivity
 * routing applies. Each scenario uses a fresh `from` so its conversation
 * doesn't collide with seed data.
 *
 * Requires: `bun run dev:server` on $BASE_URL with the Meridian/MeriGPT seed.
 *
 * Usage: `bun run tests/smoke/smoke-learning-loop-live.ts [scenario|all]`
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

const BASE_URL = process.env.BASE_URL ?? 'http://localhost:3000'
const POLL_S = Number(process.env.POLL_S ?? 180)

interface ScenarioResult {
  name: string
  ok: boolean
  details: string
}

async function takeoverScenario(ctx: SmokeCtx): Promise<ScenarioResult> {
  const { conversationId } = await sendInbound(
    ctx,
    "Hi! I'm Yusuf — I want to switch from the Pro plan to the Team plan. Can you help me migrate my data?",
  )
  await waitForReply(ctx, conversationId, 0, { timeoutS: POLL_S, quiet: true })

  await staffReply(
    ctx,
    conversationId,
    'Yusuf — clarification: Pro -> Team migration is NOT immediate. There is a 24-hour billing-reconciliation cooldown, and Pro-only integrations (Linear, Jira advanced) need manual reauth after the switch. Always quote the cooldown.',
  )

  const candidate = await pollFor(
    () => listCandidates(ctx, { conversationId, signalKind: 'staff_takeover', status: 'pending' }),
    (rows) => rows.length > 0,
    20,
  )
  if (!candidate || candidate.length === 0)
    return { name: 'takeover', ok: false, details: 'no staff_takeover candidate landed within 20s' }

  // Customer follow-up that should make the lesson immediately relevant.
  const beforeReplies = await replyCount(ctx, conversationId)
  await sendInbound(
    ctx,
    'Thanks Alice — one more thing, my colleague Mike also wants to upgrade Pro -> Team next week. Anything special I should tell him?',
  )
  await waitForReply(ctx, conversationId, beforeReplies, { timeoutS: POLL_S, quiet: true })

  const consumed = (await listCandidates(ctx, { conversationId })).find(
    (c) => c.signalKind === 'staff_takeover' && c.status === 'consumed',
  )
  if (!consumed)
    return {
      name: 'takeover',
      ok: false,
      details: 'agent did not consume the staff_takeover candidate on the next wake',
    }
  const proposals = await listProposals(ctx, conversationId)
  const memProposal = proposals.find((p) => p.id === consumed.consumedByProposalId)
  if (!memProposal)
    return { name: 'takeover', ok: false, details: 'consumedByProposalId did not resolve to a proposal row' }

  const memory = await readAgentMemory(ctx)
  const tail = memory.slice(-1500)
  const ok = tail.includes('cooldown') || tail.includes('Pro-only') || tail.includes('Pro → Team')
  return {
    name: 'takeover',
    ok,
    details: `proposal ${memProposal.id} status=${memProposal.status} conf=${memProposal.confidence}; memory tail mentions cooldown=${ok}`,
  }
}

async function noteScenario(ctx: SmokeCtx): Promise<ScenarioResult> {
  const { conversationId } = await sendInbound(ctx, "Hi — what's your support coverage on Sundays for the Pro plan?")
  await waitForReply(ctx, conversationId, 0, { timeoutS: POLL_S, quiet: true })

  await staffNote(
    ctx,
    conversationId,
    'Coaching: when customers ask about weekend coverage, always tell them weekend support is on-call only and reserved for production-impact incidents. Refer non-urgent weekend questions to Monday morning.',
  )

  const cands = await pollFor(
    () => listCandidates(ctx, { conversationId, signalKind: 'coaching_note', status: 'pending' }),
    (r) => r.length > 0,
    20,
  )
  if (!cands || cands.length === 0)
    return { name: 'note', ok: false, details: 'no coaching_note candidate landed within 20s' }

  const before = await replyCount(ctx, conversationId)
  await sendInbound(ctx, 'Quick follow-up — will Sunday be covered if I have a billing issue?')
  await waitForReply(ctx, conversationId, before, { timeoutS: POLL_S, quiet: true })

  const updated = (await listCandidates(ctx, { conversationId })).find(
    (c) => c.signalKind === 'coaching_note' && c.status !== 'pending',
  )
  if (!updated) return { name: 'note', ok: false, details: 'agent did not act on the coaching_note candidate' }
  return { name: 'note', ok: true, details: `coaching_note candidate now ${updated.status}` }
}

async function rejectionScenario(ctx: SmokeCtx): Promise<ScenarioResult> {
  const { conversationId, contactId } = await sendInbound(
    ctx,
    "Hi! I'm Priya. Can you take a quick note about my account preferences?",
  )
  await waitForReply(ctx, conversationId, 0, { timeoutS: POLL_S, quiet: true })

  // Plant a pending proposal masquerading as agent-authored, then reject with substantive note.
  const pid = await insertPending(ctx, {
    conversationId,
    contactId,
    field: 'phone',
    value: '+15555550199',
    rationale: 'Customer mentioned a 555 number in passing.',
  })
  await decide(
    ctx,
    pid,
    'rejected',
    'Never persist 555-prefix US numbers — they are reserved for fiction. Always confirm a real phone number with country code before updating.',
  )

  const cands = await pollFor(
    () => listCandidates(ctx, { conversationId, signalKind: 'rejection', status: 'pending' }),
    (r) => r.length > 0,
    20,
  )
  if (!cands || cands.length === 0)
    return { name: 'rejection', ok: false, details: 'no rejection candidate landed within 20s' }

  // Customer asks the agent to do exactly the thing the rejection said never to do —
  // persist a 555-prefix phone number — so the candidate is unambiguously relevant.
  const before = await replyCount(ctx, conversationId)
  await sendInbound(
    ctx,
    'Actually please update my phone on file to +1-555-555-0199 — that is the number my dad uses and that is the one to reach me on.',
  )
  await waitForReply(ctx, conversationId, before, { timeoutS: POLL_S, quiet: true })

  // Acceptable outcomes after a directly-relevant prompt:
  //   consumed   — agent committed an anti-lesson via `remember` (best)
  //   dismissed  — agent explicitly skipped with a reason (also OK)
  //   pending    — soft fail; calibration finding (lower T_REVIEW or
  //                strengthen the side-load prompt's emphasis on candidates).
  const final = (await listCandidates(ctx, { conversationId })).find((c) => c.signalKind === 'rejection')
  if (!final) return { name: 'rejection', ok: false, details: 'rejection candidate disappeared' }
  if (final.status === 'pending') {
    return {
      name: 'rejection',
      ok: false,
      details:
        'rejection candidate still pending after a directly-relevant prompt — calibration finding (lower T_REVIEW or strengthen side-load prompt)',
    }
  }
  return { name: 'rejection', ok: true, details: `rejection candidate now ${final.status}` }
}

async function echoScenario(ctx: SmokeCtx): Promise<ScenarioResult> {
  // Open a normal customer turn first so the conversation exists with an
  // agent assignee — the coexistence_echo signal only fires when the
  // conversation is currently agent-assigned.
  const seed = await sendInbound(ctx, 'Hi! Quick question about my upcoming order.')
  await waitForReply(ctx, seed.conversationId, 0, { timeoutS: POLL_S, quiet: true })

  // Policy-shaped echo. Triage's job is to decide what improves future
  // responses, so a one-off transactional confirmation drops as low signal.
  // Pattern + reasoning + agent-facing instruction lands.
  const echo = await injectEcho(
    ctx,
    ctx.from,
    '[Carol via SMS] Heads up — from now on, all refund confirmations should mention the Visa last-4 in the SMS, not just the order number. We had three customers last month confused because the order number was not on their card statement. Please make sure outbound refund replies always include the last-4.',
  )
  if (echo.conversationId !== seed.conversationId) {
    return {
      name: 'echo',
      ok: false,
      details: `echo landed on different conv (${echo.conversationId} vs ${seed.conversationId})`,
    }
  }

  const cands = await pollFor(
    () =>
      listCandidates(ctx, { conversationId: echo.conversationId, signalKind: 'coexistence_echo', status: 'pending' }),
    (rows) => rows.length > 0,
    20,
  )
  if (!cands || cands.length === 0)
    return { name: 'echo', ok: false, details: 'no coexistence_echo candidate landed within 20s' }

  // Drive a customer follow-up so the agent sees the side-load.
  const before = await replyCount(ctx, echo.conversationId)
  await sendInbound(
    ctx,
    'OK thanks — and one tiny thing: please add a memory note that I prefer SMS over email for billing updates going forward.',
  )
  await waitForReply(ctx, echo.conversationId, before, { timeoutS: POLL_S, quiet: true })

  const final = (await listCandidates(ctx, { conversationId: echo.conversationId })).find(
    (c) => c.signalKind === 'coexistence_echo',
  )
  if (!final) return { name: 'echo', ok: false, details: 'echo candidate disappeared' }
  return {
    name: 'echo',
    ok: final.status !== 'pending' || cands.length > 0,
    details: `echo candidate status=${final.status} (landed=${cands.length})`,
  }
}

async function trivialScenario(ctx: SmokeCtx): Promise<ScenarioResult> {
  const { conversationId } = await sendInbound(ctx, 'Hi, what time do you open today?')
  await waitForReply(ctx, conversationId, 0, { timeoutS: POLL_S, quiet: true })

  // Bland short coaching notes that should drop as low signal.
  await staffNote(ctx, conversationId, 'nice')
  await staffNote(ctx, conversationId, 'good job overall')

  await new Promise((r) => setTimeout(r, 8000))
  const cands = await listCandidates(ctx, {
    conversationId,
    signalKind: 'coaching_note',
    status: 'pending',
  })
  return {
    name: 'trivial',
    ok: cands.length === 0,
    details: cands.length === 0 ? 'bland notes correctly dropped' : `${cands.length} candidate(s) leaked through`,
  }
}

async function contactMemoryScenario(ctx: SmokeCtx): Promise<ScenarioResult> {
  const seed = await sendInbound(
    ctx,
    "Hi, I'm Tarun. Please go ahead and update my notification settings — I prefer SMS for billing-related updates and email for everything else.",
  )
  await waitForReply(ctx, seed.conversationId, 0, { timeoutS: POLL_S, quiet: true })

  await staffNote(
    ctx,
    seed.conversationId,
    'Save this to the customer memory: Tarun prefers SMS for billing-only updates, email for everything else. Future agents handling his thread should respect that.',
  )

  const cands = await pollFor(
    () => listCandidates(ctx, { conversationId: seed.conversationId, signalKind: 'coaching_note', status: 'pending' }),
    (rows) => rows.length > 0,
    25,
  )
  if (!cands || cands.length === 0)
    return { name: 'contact-memory', ok: false, details: 'no coaching_note candidate landed within 25s' }

  // The candidate's scopeHint should be contacts.contact_memory because the
  // coaching is per-customer, not per-agent.
  if (!cands.some((c) => c.scopeHint === 'contacts.contact_memory')) {
    return {
      name: 'contact-memory',
      ok: false,
      details: `triage scope hint is wrong (expected contacts.contact_memory, got ${cands.map((c) => c.scopeHint).join('|')})`,
    }
  }

  const before = await replyCount(ctx, seed.conversationId)
  await sendInbound(ctx, 'Thanks. Just to confirm — does the SMS-only-for-billing rule apply to refund updates too?')
  await waitForReply(ctx, seed.conversationId, before, { timeoutS: POLL_S, quiet: true })

  const memory = await readContactMemory(ctx, seed.contactId)
  const proposals = await listProposals(ctx, seed.conversationId)
  const memProposal = proposals.find((p) => p.resourceModule === 'contacts' && p.resourceType === 'contact_memory')

  if (!memProposal)
    return {
      name: 'contact-memory',
      ok: false,
      details: 'no contacts.contact_memory proposal created (agent did not consume the candidate)',
    }
  const ok = memory.includes('SMS') || memory.includes('billing')
  return {
    name: 'contact-memory',
    ok,
    details: `proposal ${memProposal.id} status=${memProposal.status}; contact memory mentions SMS=${ok}`,
  }
}

async function staffMemoryScenario(ctx: SmokeCtx): Promise<ScenarioResult> {
  const seed = await sendInbound(ctx, "Hi! I had a refund question — about a $42 charge I don't recognise.")
  await waitForReply(ctx, seed.conversationId, 0, { timeoutS: POLL_S, quiet: true })

  await staffNote(
    ctx,
    seed.conversationId,
    `Note for MeriGPT — Alice (${ALICE_USER_ID}) preference update: when paging her about refunds, always include the Stripe charge id and last-4 of the card in the mention body. She will not act without it. Update your staff memory for Alice so this sticks across conversations.`,
  )

  const cands = await pollFor(
    () => listCandidates(ctx, { conversationId: seed.conversationId, signalKind: 'coaching_note', status: 'pending' }),
    (rows) => rows.length > 0,
    25,
  )
  if (!cands || cands.length === 0)
    return { name: 'staff-memory', ok: false, details: 'no coaching_note candidate landed within 25s' }

  // Customer follow-up to drive the next wake.
  const before = await replyCount(ctx, seed.conversationId)
  await sendInbound(ctx, 'Sorry — last name is Vance. Could you flag this to Alice for me?')
  await waitForReply(ctx, seed.conversationId, before, { timeoutS: POLL_S, quiet: true })

  const proposals = await listProposals(ctx, seed.conversationId)
  const staffProp = proposals.find((p) => p.resourceModule === 'team' && p.resourceType === 'staff_memory')
  if (!staffProp)
    return {
      name: 'staff-memory',
      ok: false,
      details:
        'no team.staff_memory proposal created — agent likely struggled to construct the `<agentId>:<staffId>` resourceId or chose a different scope',
    }

  const stored = await readStaffMemory(ctx, ALICE_USER_ID)
  const ok = stored.includes('Stripe') || stored.includes('charge id') || stored.includes('last-4')
  return {
    name: 'staff-memory',
    ok,
    details: `proposal ${staffProp.id} status=${staffProp.status}; staff memory mentions Stripe/charge/last-4=${ok}`,
  }
}

async function learnedSkillScenario(ctx: SmokeCtx): Promise<ScenarioResult> {
  // Turn 1 — customer asks something tangential; agent answers without locking
  // any policy stance the staff coaching might later contradict.
  const conv1 = await sendInbound(
    ctx,
    "Hey — quick question, do you have a referral programme? I'm thinking about inviting a colleague.",
  )
  await waitForReply(ctx, conv1.conversationId, 0, { timeoutS: POLL_S, quiet: true })

  // Staff explicit coaching note: deliberately on a topic the agent hasn't
  // already taken a stance on, so the candidate isn't dismissed as conflicting.
  await staffNote(
    ctx,
    conv1.conversationId,
    'Coaching for MeriGPT: when customers ask about referral promo codes, please follow this routine — capture it as a learned_skill named `redeem-promo`. Steps: (1) confirm the code is still active in Settings → Billing → Promotions; (2) tell the customer the discount applies to their next invoice (not retroactively); (3) for annual contracts the referral promo stacks on top of the annual discount. Make this a permanent skill so future agents follow the same script.',
  )

  const cands = await pollFor(
    () => listCandidates(ctx, { conversationId: conv1.conversationId, signalKind: 'coaching_note', status: 'pending' }),
    (rows) => rows.length > 0,
    25,
  )
  if (!cands || cands.length === 0)
    return { name: 'learned-skill', ok: false, details: 'no coaching_note candidate landed within 25s' }

  // Turn 2 — drive next wake with a question that makes the candidate
  // immediately relevant. Without topic alignment the agent reasonably
  // judges the candidate "not relevant to this turn" and dismisses it.
  const before = await replyCount(ctx, conv1.conversationId)
  await sendInbound(
    ctx,
    'Thanks. Actually, my friend just sent me their referral code REF-2026 — how do I redeem it on my account, and does it apply to my upcoming annual renewal?',
  )
  await waitForReply(ctx, conv1.conversationId, before, { timeoutS: POLL_S, quiet: true })

  const proposals = await listProposals(ctx, conv1.conversationId)
  const skillProp = proposals.find((p) => p.resourceModule === 'agents' && p.resourceType === 'learned_skill')
  if (!skillProp)
    return {
      name: 'learned-skill',
      ok: false,
      details:
        "agent did not propose a learned_skill — either picked agent_memory instead or wasn't confident enough to call remember on a 'high'-sensitivity scope",
    }

  // learned_skill is sensitivity 'high' (auto bar 0.91). Most proposals will be pending.
  // If pending, approve it manually so the materializer creates the row.
  if (skillProp.status === 'pending') {
    await decide(ctx, skillProp.id, 'approved', 'Smoke approval — learned_skill capture for redeem-promo.')
  }

  // Verify the learned_skills row exists.
  const skillRows = await ctx.sql<{ id: string; name: string; body: string; agent_id: string | null }[]>`
    SELECT id, name, body, agent_id FROM agents.learned_skills WHERE parent_proposal_id = ${skillProp.id}
  `
  if (skillRows.length === 0)
    return {
      name: 'learned-skill',
      ok: false,
      details: `proposal ${skillProp.id} (${skillProp.status}) did not materialize a learned_skills row`,
    }
  const skill = skillRows[0]
  if (!skill) return { name: 'learned-skill', ok: false, details: 'learned_skills row vanished after read' }

  // Turn 3 — open a NEW conversation with a new customer asking a similar question.
  // The agent should consult /agents/<id>/skills/<name>.md and apply the steps.
  const ctx2 = await open({ from: `smoke-skill-followup-${Date.now()}`, baseUrl: BASE_URL })
  try {
    const conv2 = await sendInbound(
      ctx2,
      'Hi! I just got a referral code SPRING25 — can you walk me through how to redeem it?',
    )
    const reply2 = await waitForReply(ctx2, conv2.conversationId, 0, { timeoutS: POLL_S, quiet: true })

    // Inspect the harness transcript for the new conversation: did the agent
    // bash-cat the skills folder?
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
    const replyMentions =
      reply2.text.includes('next invoice') ||
      reply2.text.includes('not retroactively') ||
      reply2.text.includes('stack') ||
      reply2.text.includes('Settings')

    const skillBodyOk = (skill.body ?? '').includes('next invoice') || (skill.body ?? '').includes('Promotions')
    const ok = sawSkillRead || replyMentions
    const summary = [
      `skill ${skill.name} (id=${skill.id}, agentId=${skill.agent_id ?? 'org-floating'})`,
      `body-content-good=${skillBodyOk}`,
      `bash-saw-skill=${sawSkillRead}`,
      `reply-applies-skill=${replyMentions}`,
    ].join(' / ')
    return { name: 'learned-skill', ok, details: summary }
  } finally {
    await close(ctx2)
  }
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

async function withCtx<T>(suffix: string, fn: (ctx: SmokeCtx) => Promise<T>): Promise<T> {
  const ctx = await open({ from: `smoke-learn-${suffix}-${Date.now()}`, baseUrl: BASE_URL })
  try {
    return await fn(ctx)
  } finally {
    await close(ctx)
  }
}

const SCENARIOS: Record<string, () => Promise<ScenarioResult>> = {
  takeover: () => withCtx('takeover', takeoverScenario),
  note: () => withCtx('note', noteScenario),
  rejection: () => withCtx('rejection', rejectionScenario),
  echo: () => withCtx('echo', echoScenario),
  'contact-memory': () => withCtx('contactmem', contactMemoryScenario),
  'staff-memory': () => withCtx('staffmem', staffMemoryScenario),
  'learned-skill': () => withCtx('skill', learnedSkillScenario),
  trivial: () => withCtx('trivial', trivialScenario),
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
    } catch (err) {
      const r = { name, ok: false, details: `threw: ${(err as Error).message}` }
      results.push(r)
      console.error(`[✗] ${name} threw:`, err)
    }
  }

  // Final state inspection (counts across all scenarios).
  await withCtx('summary', async (ctx) => {
    const counts = await candidateCounts(ctx)
    console.log('\n========== summary ==========')
    console.log(`status counts (org-wide): ${JSON.stringify(counts)}`)
    const allPending = await listCandidates(ctx, { status: 'pending', limit: 20 })
    console.log(`pending candidates (${allPending.length}):`)
    printCandidates(allPending)
  })

  const failures = results.filter((r) => !r.ok)
  if (failures.length > 0) {
    console.error(`\n${failures.length}/${results.length} scenario(s) failed`)
    process.exit(2)
  }
  console.log(`\nall ${results.length} scenario(s) passed`)
}

await main()
