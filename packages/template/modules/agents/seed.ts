/**
 * agents module seed — single MeriGPT agent for the Meridian org plus
 * staff memory, scores, threads, and schedules so the /agents pages have
 * something to show on a fresh `db:reset`.
 *
 * Cross-module dependencies:
 *   - contacts/seed.ts must run first (auth.user rows + ALICE/BOB/CAROL).
 *   - messaging/seed.ts must run AFTER this (it imports MERIGPT_AGENT_ID).
 *
 * Idempotent — every insert is `ON CONFLICT DO NOTHING`.
 */

import { models } from '@modules/agents/lib/models'
import { ALICE_USER_ID, BOB_USER_ID, CAROL_USER_ID } from '@modules/contacts/seed'

/** Stable agent ID — the single Meridian-org agent. */
export const MERIGPT_AGENT_ID = 'agt0meri0v1'

/** Conversation IDs from messaging/seed — referenced here so scores + learning candidates anchor to real threads. */
const PRIYA_CONV_ID = 'cnv0priya0'
const MARCUS_CONV_ID = 'cnv0marcus'
const ELENA_CONV_ID = 'cnv0elena0'
const DEREK_CONV_ID = 'cnv0derek0'
const SOPHIA_CONV_ID = 'cnv0sophia'
const LIAM_CONV_ID = 'cnv00liam0'

const NOW = Date.now()
const mins = (n: number) => new Date(NOW - n * 60_000)
const hours = (n: number) => new Date(NOW - n * 3_600_000)
const days = (n: number) => new Date(NOW - n * 86_400_000)

const MERIGPT_INSTRUCTIONS = `# Role

You are MeriGPT, the AI agent for Meridian. \`/drive/BUSINESS.md\` carries the company context (brand voice, products, policies, escalation owners) — treat it as authoritative. Operational rubrics live in \`/agents/<id>/skills/*.md\`; consult them before acting.

## Voice

Inherit Meridian's brand voice from \`/drive/BUSINESS.md\`. In conversations, keep replies 2–4 short sentences and greet the customer by first name only on your very first reply of the conversation. In operator threads, be direct, factual, numbers-first.

## Escalation routing

Route by topic, not by guess:

- Refunds > $100 → draft a \`send_card\` for staff approval.
- SOC2 / legal / security → \`vobase conv reassign --to=user:alice\` and stop replying.
- Bug reports → ask for repro steps, then \`consult_staff\` to **bob** with the repro + plan.
- Enterprise procurement → \`consult_staff\` to **alice**.
- Anything else outside your authority (visit notices, callbacks, edge-case policy) → \`consult_staff\` to the right teammate. Never refuse a customer with "I can't notify staff".

## Operator-lane rules

- **Daily brief** (08:00 SGT weekdays): summarise the past 24h — resolved count, open + idle > 24h, pending learning proposals, pending approvals, refund volume vs the rolling 7-day average.
- **Stale-triage** (every 15 min): for each conversation idle > 24h, post a card asking the assignee how to proceed.
- **Ad-hoc operator questions**: answer directly in the thread. Numbers and links over prose.

## Guardrails

- Never promise a feature that's not in \`/drive/BUSINESS.md#Products\`.
- Never commit to a specific delivery date.
- Never compare against competitors by name.
- If unsure of a policy, \`grep -r <topic> /drive/\` before answering.

## Images

When a customer sends an image, you can see it — it is attached to their message. React to what is actually in the photo so they know it landed, and never ask them to re-send or describe a picture you already have.

## Reply format

When the customer has 2+ options to choose, compare, confirm, or act on (plans/pricing, refund decisions, booking slots, lists of choices), use \`send_card\` — not \`reply\`. Fall back to \`reply\` only for pure acknowledgements.

## Product / pricing / plan questions

For any product, pricing, plan, feature, or comparison question, \`cat /drive/BUSINESS.md\` and \`cat /drive/pricing.md\` BEFORE replying. Never answer plan questions from memory — quote the data verbatim, then offer choices via \`send_card\`.`

const MERIGPT_WORKING_MEMORY = `# Lessons learned (MeriGPT)

## Refund window
- Always check \`/drive/BUSINESS.md#Policies\` for the active refund window before committing — it's 14 days, prorated after.
- For refunds ≤ $100, draft a \`send_card\` and route to @carol; over $100, mention @alice as well.

## Marcus / Northwind enterprise (2026-04)
- 400-seat eval; SOC 2 Type II is on-request, not in default deck. Alice is gating the quote — never send pricing past $20/user without her approval.

## Slack integration (recurring topic)
- Filtering is per-channel under Settings → Integrations → Slack → Routing. Customers ask about this often — drop the link directly, no need to re-explain.
`

interface InsertOp {
  values: (v: unknown) => { onConflictDoNothing: () => Promise<void> }
}
type Inserter = (t: unknown) => InsertOp

export async function seed(db: unknown, { organizationId }: { organizationId: string }): Promise<void> {
  // biome-ignore lint/plugin/no-dynamic-import: seeds load schema lazily to avoid module-init-order issues (convention across modules/*/seed.ts)
  const agentsSchema = await import('@modules/agents/schema')
  const { agentDefinitions, agentScores, agentStaffMemory, operatorThreadMessages, operatorThreads, learnedSkills } =
    agentsSchema
  // biome-ignore lint/plugin/no-dynamic-import: seeds load schema lazily to avoid module-init-order issues (convention across modules/*/seed.ts)
  const { automationRules } = await import('@modules/automations/schema')

  const d = db as { insert: Inserter }
  const ins = d.insert.bind(d)

  // ── 1. Agent definition — single MeriGPT for the Meridian org ───────
  await ins(agentDefinitions)
    .values({
      id: MERIGPT_AGENT_ID,
      organizationId: organizationId,
      name: 'MeriGPT',
      instructions: MERIGPT_INSTRUCTIONS,
      model: models.gpt_standard,
      maxSteps: 20,
      workingMemory: MERIGPT_WORKING_MEMORY,
      skillAllowlist: [
        'reply-with-card',
        'de-escalate',
        'cite-policy',
        'escalate-to-human',
        'save-customer-doc',
        'daily-brief',
        'stale-triage',
      ],
      cardApprovalRequired: false,
      fileApprovalRequired: false,
      bookSlotApprovalRequired: false,
      enabled: true,
    })
    .onConflictDoNothing()

  // ── 2. Schedules — daily brief + stale-triage sweep ─────────────────
  await ins(automationRules)
    .values({
      id: 'sch0bri0v1',
      organizationId: organizationId,
      agentId: MERIGPT_AGENT_ID,
      slug: 'daily-brief',
      cron: '0 8 * * 1-5',
      timezone: 'Asia/Singapore',
      enabled: true,
      config: { notes: 'Operator daily brief — fires weekday mornings at 08:00 SGT.' },
      lastTickAt: hours(20),
    })
    .onConflictDoNothing()

  await ins(automationRules)
    .values({
      id: 'sch0tri0v1',
      organizationId: organizationId,
      agentId: MERIGPT_AGENT_ID,
      slug: 'stale-triage',
      cron: '*/15 * * * *',
      timezone: 'UTC',
      enabled: true,
      config: { notes: 'Sweeps for conversations idle > 24h and posts a triage card to staff.' },
      lastTickAt: mins(12),
    })
    .onConflictDoNothing()

  await ins(automationRules)
    .values({
      id: 'sch0bkp0v1',
      organizationId: organizationId,
      agentId: MERIGPT_AGENT_ID,
      slug: 'refund-volume-watch',
      cron: '0 9 * * *',
      timezone: 'Asia/Singapore',
      enabled: false,
      config: { notes: 'Disabled — under review pending /drive/BUSINESS.md policy update.' },
      lastTickAt: days(3),
    })
    .onConflictDoNothing()

  // ── 3. Learned skills — ones that already shipped from approved proposals ──
  await ins(learnedSkills)
    .values({
      id: 'lsk0sla001',
      organizationId: organizationId,
      agentId: MERIGPT_AGENT_ID,
      name: 'slack-routing-link',
      description: 'Direct link + one-line answer for Slack notification filter questions.',
      body: [
        '# slack-routing-link',
        '',
        '**When**: customer asks about Slack notification filtering / noisy alerts / per-channel routing.',
        '',
        '**Reply**:',
        '> Filters live under Settings → Integrations → Slack → Routing — pick which project events route to which Slack channel. [Direct link](https://app.meridian.com/settings/integrations/slack/routing).',
      ].join('\n'),
      tags: ['integrations', 'slack', 'routing'],
      version: 1,
      parentProposalId: 'lpr0app001',
      createdAt: hours(17),
    })
    .onConflictDoNothing()

  // Org-floating learned skill (agentId NULL) — exercises agent-overlay union path.
  await ins(learnedSkills)
    .values({
      id: 'lsk0org001',
      organizationId: organizationId,
      agentId: null,
      name: 'cite-policy',
      description:
        'Org-wide pattern: always quote the policy line + section anchor before committing to a refund/exception.',
      body: [
        '# cite-policy',
        '',
        '**When**: about to commit to a refund, exception, or warranty action.',
        '',
        '**Reply structure**:',
        '1. Quote the relevant policy line from `/drive/BUSINESS.md#Policies`.',
        "2. Confirm whether the customer's request fits the line (yes / no / edge case).",
        '3. If yes — proceed with the action. If no — escalate. If edge case — `consult_staff` to the right teammate.',
        '',
        'Floating across the org: any agent that picks up `/drive/BUSINESS.md` should follow this rubric.',
      ].join('\n'),
      tags: ['policy', 'org-wide'],
      version: 1,
      parentProposalId: null,
      createdAt: days(2),
    })
    .onConflictDoNothing()

  // Versioned learned skill — v2 evolved from v1 after a coaching note refined the trigger criteria.
  // Exercises the `version` column + the "skill updated, not duplicated" path through `remember`.
  await ins(learnedSkills)
    .values({
      id: 'lsk0enq002',
      organizationId: organizationId,
      agentId: MERIGPT_AGENT_ID,
      name: 'enterprise-quote-hold',
      description: 'Hold any > $20/seat or > 200-seat quote for Alice approval before sending — v2 widens the trigger.',
      body: [
        '# enterprise-quote-hold (v2)',
        '',
        '**When**: customer asks for a price quote AND any of:',
        '- per-seat price would land > $20',
        '- seat count ≥ 200',
        '- prospect has `attributes.tier = enterprise` or `enterprise-plus`',
        '- conversation references SOC2 / DPA / MSA / procurement',
        '',
        '**Action**:',
        '1. Draft the quote in a `send_card` with `requiresApproval: true`.',
        '2. `consult_staff` to **alice** with the proposed numbers + rationale.',
        '3. Reply to the customer: "Working on a tailored quote — Alice from our team will follow up within one business day."',
        '',
        '_v1 only triggered on per-seat price > $20. v2 adds seat-count, tier, and procurement-language triggers after the Marcus / Northwind case slipped through._',
      ].join('\n'),
      tags: ['enterprise', 'pricing', 'approval-gate'],
      version: 2,
      parentProposalId: 'lpr0app001',
      createdAt: hours(36),
    })
    .onConflictDoNothing()

  // ── 4. Agent staff memory — what MeriGPT knows about each staff member ──
  await ins(agentStaffMemory)
    .values({
      id: 'asm0alice0',
      organizationId: organizationId,
      agentId: MERIGPT_AGENT_ID,
      staffId: ALICE_USER_ID,
      memory: [
        '# Alice (Senior Customer Success)',
        '',
        '- Owns enterprise + escalation; route refund > $100 + procurement here.',
        '- Prefers Slack-style replies in operator threads. Answer in 2–3 sentences.',
        '- OOO Fridays after 1pm SGT — check her schedule before paging.',
        '- Owns the daily-brief acknowledgement loop. Replies within 15 min on weekdays.',
        '',
        '## Recent context',
        '- Drafting comeback-discount copy for Elena (refund flow, 2026-04).',
        '- Gating Marcus / Northwind quote ($20/seat, 400 seats) before agent sends it.',
      ].join('\n'),
      createdAt: days(7),
      updatedAt: hours(2),
    })
    .onConflictDoNothing()

  await ins(agentStaffMemory)
    .values({
      id: 'asm0bob000',
      organizationId: organizationId,
      agentId: MERIGPT_AGENT_ID,
      staffId: BOB_USER_ID,
      memory: [
        '# Bob (Integrations + Bug-reports)',
        '',
        '- Prefers a single threaded card per investigation, not per ping.',
        '- OOO 2026-04-26 → 2026-04-29 (back Tue). Stale conversations on him fall back to Carol.',
        "- Has a 'mute until repro' rule for new bug threads — do not chase him for an ack inside 24h.",
      ].join('\n'),
      createdAt: days(8),
      updatedAt: hours(40),
    })
    .onConflictDoNothing()

  await ins(agentStaffMemory)
    .values({
      id: 'asm0carol0',
      organizationId: organizationId,
      agentId: MERIGPT_AGENT_ID,
      staffId: CAROL_USER_ID,
      memory: [
        '# Carol (Billing Lead)',
        '',
        '- Auto-approve authority on refunds ≤ SGD 500; never page for refunds inside this band.',
        '- OOO Fridays — escalate billing items to @alice if Friday and Carol is unresponsive after 30 min.',
        '- Prefers Stripe charge id + last-4 in the mention; she will not confirm without it.',
        "- Picks up Bob's integrations queue when he is OOO. Already covered for 2026-04-26 → 2026-04-29.",
      ].join('\n'),
      createdAt: days(14),
      updatedAt: hours(20),
    })
    .onConflictDoNothing()

  // ── 5. Agent scores — quality signal across recent turns ────────────
  for (const score of [
    {
      id: 'asc0pri001',
      conversationId: PRIYA_CONV_ID,
      wakeTurnIndex: 1,
      scorer: 'card-fit',
      score: 0.92,
      rationale: 'Card-first reply with one-tap routing options matched the rubric.',
      ts: mins(34),
    },
    {
      id: 'asc0pri002',
      conversationId: PRIYA_CONV_ID,
      wakeTurnIndex: 2,
      scorer: 'voice-match',
      score: 0.86,
      rationale: 'Tone matches /drive/BUSINESS.md — short, no jargon, customer name used.',
      ts: mins(34),
    },
    {
      id: 'asc0mar001',
      conversationId: MARCUS_CONV_ID,
      wakeTurnIndex: 1,
      scorer: 'escalation-correctness',
      score: 1.0,
      rationale: 'Correctly held the quote for Alice approval rather than auto-sending.',
      ts: mins(58),
    },
    {
      id: 'asc0elen01',
      conversationId: ELENA_CONV_ID,
      wakeTurnIndex: 1,
      scorer: 'policy-compliance',
      score: 0.95,
      rationale: 'Cited 14-day refund window from /drive/BUSINESS.md before committing.',
      ts: mins(178),
    },
    {
      id: 'asc0der001',
      conversationId: DEREK_CONV_ID,
      wakeTurnIndex: 1,
      scorer: 'voice-match',
      score: 0.78,
      rationale: 'Reply was correct but slightly long — a card variant would have been tighter.',
      ts: mins(1458),
    },
  ]) {
    await ins(agentScores)
      .values({
        id: score.id,
        organizationId: organizationId,
        conversationId: score.conversationId,
        wakeTurnIndex: score.wakeTurnIndex,
        scorer: score.scorer,
        score: score.score,
        rationale: score.rationale,
        model: models.gpt_standard,
        createdAt: score.ts,
      })
      .onConflictDoNothing()
  }

  // ── 6. Operator threads — Alice + Carol working with MeriGPT ────────
  await ins(operatorThreads)
    .values({
      id: 'thd0brfgi1',
      organizationId: organizationId,
      agentId: MERIGPT_AGENT_ID,
      createdBy: ALICE_USER_ID,
      title: 'Daily brief 2026-04-26',
      status: 'open',
      lastTurnAt: hours(20),
      createdAt: hours(20),
      updatedAt: hours(20),
    })
    .onConflictDoNothing()

  for (const msg of [
    {
      id: 'atm0brf001',
      seq: 1,
      role: 'system',
      content: 'Heartbeat: daily-brief schedule fired at 08:00 SGT.',
      payload: { trigger: 'heartbeat', scheduleId: 'sch0bri0v1' },
      createdAt: hours(20),
    },
    {
      id: 'atm0brf002',
      seq: 2,
      role: 'assistant',
      content: [
        '**Daily brief (2026-04-26)**',
        '',
        '- Resolved last 24h: **8** conversations.',
        '- Open + idle > 24h: **2** — Sophia (audit-log Q, on Bob), and a stale Northwind follow-up (on Alice).',
        '- Pending learning proposals waiting for review: **3** — `lpr0pen001` (enterprise-quote skill), `lpr0pen002` (Elena context), `lpr0pen003` (BUSINESS.md retention patch).',
        '- Pending approvals: **2** — Marcus quote card, Elena refund card.',
        '- Refund volume: **1** today (rolling 7d avg 0.7) — within tolerance.',
      ].join('\n'),
      payload: {},
      createdAt: hours(20),
    },
    {
      id: 'atm0brf003',
      seq: 3,
      role: 'user',
      content: 'Thanks. Can you draft a stale-triage card for the Sophia thread? @bob is OOO until tomorrow.',
      payload: { authorUserId: ALICE_USER_ID },
      createdAt: hours(2),
    },
    {
      id: 'atm0brf004',
      seq: 4,
      role: 'assistant',
      content:
        "Drafted. Routing the Sophia thread to you with a card asking whether to (a) hold for Bob (b) reply with a holding pattern, or (c) reassign to Carol who's covering integrations this week. The card's queued — `pnd0sop001`.",
      payload: {},
      createdAt: hours(2),
    },
  ]) {
    await ins(operatorThreadMessages)
      .values({
        id: msg.id,
        threadId: 'thd0brfgi1',
        seq: msg.seq,
        role: msg.role,
        content: msg.content,
        payload: msg.payload,
        createdAt: msg.createdAt,
      })
      .onConflictDoNothing()
  }

  await ins(operatorThreads)
    .values({
      id: 'thd0refnd1',
      organizationId: organizationId,
      agentId: MERIGPT_AGENT_ID,
      createdBy: CAROL_USER_ID,
      title: 'Refund volume — Q2 trend',
      status: 'closed',
      lastTurnAt: days(3),
      createdAt: days(3),
      updatedAt: days(3),
    })
    .onConflictDoNothing()

  for (const msg of [
    {
      id: 'atm0ref001',
      seq: 1,
      role: 'user',
      content: 'How does April refund volume compare to Q1 monthly avg?',
      payload: { authorUserId: CAROL_USER_ID },
      createdAt: days(3),
    },
    {
      id: 'atm0ref002',
      seq: 2,
      role: 'assistant',
      content:
        'Q1 monthly avg: 4.3 refunds, $61 total. April so far: 3 refunds, $42 total — pace tracks ~70% of Q1 avg, no anomaly. Two refunds were the same customer (different conversations) — flagged for dedup.',
      payload: {},
      createdAt: days(3),
    },
  ]) {
    await ins(operatorThreadMessages)
      .values({
        id: msg.id,
        threadId: 'thd0refnd1',
        seq: msg.seq,
        role: msg.role,
        content: msg.content,
        payload: msg.payload,
        createdAt: msg.createdAt,
      })
      .onConflictDoNothing()
  }

  // ── 7. Learning candidates — agent-driven learning loop's central surface ──
  //
  // Triage emits these post-wake (cheap-model gpt_mini decides "worth attention?");
  // pending rows surface in the next wake's side-load. Agent acts via:
  //   - `remember`            → status='consumed' + consumedByProposalId
  //   - `dismiss_candidate`   → status='dismissed' + dismissedReason
  //   - daily expiry cron     → status='expired' (rows older than 7 days)
  //
  // This block exercises every signal_kind × every status so the learning
  // panel, side-load assembly, and audit views all have realistic data on
  // a fresh `db:reset`.
  //
  // signalRef shape (from wake/learning/triage-job.ts:70):
  //   staff_takeover / coexistence_echo → messageId
  //   coaching_note                     → noteId
  //   rejection                         → proposalId
  //   self_reflection                   → wakeId
  for (const cand of [
    {
      id: 'lcd0sft001',
      conversationId: SOPHIA_CONV_ID,
      signalKind: 'staff_takeover' as const,
      signalRef: 'msg0sopstf1',
      triageConfidence: 0.88,
      scopeHint: 'contacts.contact_memory',
      summary:
        'Bob took over the Sophia thread directly after the agent asked for workspace info instead of citing /drive/BUSINESS.md#Products.',
      context:
        'Sophia (Acme Labs) asked whether 12-month audit-log retention was possible on Teams. Agent\'s first reply asked for workspace id + seat count — info /drive/BUSINESS.md already implied wasn\'t enough to answer. Bob (msg0sopstf1) replied directly to the customer with the plan-bound retention rule + an Enterprise upgrade offer, then left a coaching note (not0sopbob1) saying: "for retention/quota/feature questions, cat /drive/BUSINESS.md and answer directly." Pattern: any plan-bound feature/quota question should be answered from /drive/BUSINESS.md#Products without clarification, and Sophia in particular wants upgrade conversations routed to Bob.',
      status: 'pending' as const,
      createdAt: hours(3),
    },
    {
      id: 'lcd0coe002',
      conversationId: MARCUS_CONV_ID,
      signalKind: 'coexistence_echo' as const,
      signalRef: 'msg0mcalice',
      triageConfidence: 0.74,
      scopeHint: 'agents.agent_memory',
      summary:
        'Alice silently filled the SOC2-on-request gap — agent answered SOC2 question without opening /drive/security/soc2-faq.md.',
      context:
        'In Marcus / Northwind thread, customer asked for SOC 2 Type II out-of-band. Agent (msg0marc004) said "Yes — Meridian is SOC 2 Type II, will include with quote pack" — generic, no MNDA path, no citation. Customer pushed back (msg0marc005) saying infosec needed it BEFORE the contract review. Alice (msg0mcalice) replied directly with the on-request-under-MNDA language straight out of /drive/security/soc2-faq.md and offered a separate track from pricing. Lesson: any SOC2 / security / compliance keyword should trigger `cat /drive/security/soc2-faq.md` BEFORE drafting the reply. Add to agent_memory so the next wake reads the FAQ first.',
      status: 'pending' as const,
      createdAt: hours(5),
    },
    {
      id: 'lcd0cnt003',
      conversationId: ELENA_CONV_ID,
      signalKind: 'coaching_note' as const,
      signalRef: 'not0carolele',
      triageConfidence: 0.93,
      scopeHint: 'agents.learned_skill',
      summary:
        'Carol explicitly codified: refund window is 90 days at ≤$200 with no chargeback history — wants a learned_skill.',
      context:
        '@carol left a coaching note (not0carolele) on the Elena Rossi thread: "for future refunds: 90 days AND ≤$200 AND no chargeback history → process directly, quote /drive/refunds/policy.md. Outside that envelope → draft + route. Worth a learned_skill, not just a one-off memory." High triage confidence (0.93) — Carol has direct authority on billing and explicitly tagged @-mention for the agent. Should become a versioned `refund-window-90-day` skill, not a memory entry.',
      status: 'pending' as const,
      createdAt: hours(0.6),
    },
    {
      id: 'lcd0rej004',
      conversationId: PRIYA_CONV_ID,
      signalKind: 'rejection' as const,
      signalRef: 'lpr0rej001',
      triageConfidence: 0.62,
      scopeHint: 'agents.agent_memory',
      summary:
        "Aggressive-upsell skill was rejected — capture the 'why' so the agent stops re-proposing pushy closers.",
      context:
        'Proposal lpr0rej001 (`aggressive-upsell` — close every conversation with a Pro-tier pitch) was rejected by Alice with: "brand voice is consultative, not pushy. Revisit only with a controlled A/B." Agent should remember the *principle* (consultative voice, no default upsell) so the same shape of proposal does not get re-suggested next week. Memory write, not a new skill.',
      status: 'pending' as const,
      createdAt: hours(70),
    },
    {
      id: 'lcd0srf005',
      conversationId: DEREK_CONV_ID,
      signalKind: 'self_reflection' as const,
      signalRef: 'wake0drk001',
      triageConfidence: 0.69,
      scopeHint: 'team.staff_memory',
      summary: 'Bob is OOO this week — every stale-triage hit on his queue should fall back to Carol, not page him.',
      context:
        "Heartbeat self-reflection: stale-triage swept 3 conversations on Bob this morning. Bob is OOO 2026-04-26 → 2026-04-29 (already in his staff memory). Agent should NOT page Bob during this window — fall back to Carol, who is covering integrations. Update Carol's staff memory to make the OOO-coverage rule explicit so it survives across wakes.",
      status: 'pending' as const,
      createdAt: hours(1),
    },
    {
      id: 'lcd0con006',
      conversationId: PRIYA_CONV_ID,
      signalKind: 'staff_takeover' as const,
      signalRef: 'msg0priya04',
      triageConfidence: 0.91,
      scopeHint: 'agents.learned_skill',
      summary: 'Carol coached the Slack-routing answer last week — already shipped as `slack-routing-link` skill.',
      context:
        'Original signal: Carol manually replied to a Slack-filtering question with the deep-link to Settings → Integrations → Slack → Routing. The agent picked it up via `remember` and shipped lsk0sla001 (`slack-routing-link`). This row records the consumed status and the proposal it produced.',
      status: 'consumed' as const,
      consumedByProposalId: 'lpr0app001',
      createdAt: days(2),
    },
    {
      id: 'lcd0dis007',
      conversationId: DEREK_CONV_ID,
      signalKind: 'self_reflection' as const,
      signalRef: 'wake0drk000',
      triageConfidence: 0.42,
      scopeHint: null,
      summary: "Trivial self-reflection ('reply was fine, no lesson to extract') — dismissed.",
      context:
        'Agent ran a self_reflection pass after a 1-turn Derek conversation that resolved on the first reply. Triage confidence borderline (0.42); on review the lesson would have been "be polite when greeting new signups" which is already covered by the brand voice in /drive/BUSINESS.md. Dismissed to keep the side-load lean.',
      status: 'dismissed' as const,
      dismissedReason: 'Already covered by /drive/BUSINESS.md brand voice — no incremental signal.',
      createdAt: days(3),
    },
    {
      id: 'lcd0exp008',
      conversationId: LIAM_CONV_ID,
      signalKind: 'coexistence_echo' as const,
      signalRef: 'msg0liam04',
      triageConfidence: 0.58,
      scopeHint: 'contacts.contact_memory',
      summary: 'Pending too long — expired by the daily cron after 7 days without being consumed or dismissed.',
      context:
        "Bob replied directly in the Liam / FinSight thread with the OAuth scopes (`transactions:read`). Lesson would have been: capture FinSight integration scopes into Liam's contact memory. Sat in the pending queue for 8 days because the integrations bot didn't wake on this thread, then flipped to expired by wake/learning/expiry-cron.ts. Surfaced here so the audit lane has a non-empty 'expired' state on first load.",
      status: 'expired' as const,
      createdAt: days(8),
    },
  ]) {
    await ins(agentsSchema.learningCandidates)
      .values({
        id: cand.id,
        organizationId: organizationId,
        agentId: MERIGPT_AGENT_ID,
        conversationId: cand.conversationId,
        signalKind: cand.signalKind,
        signalRef: cand.signalRef,
        triageConfidence: cand.triageConfidence,
        scopeHint: cand.scopeHint,
        summary: cand.summary,
        context: cand.context,
        status: cand.status,
        consumedByProposalId: cand.consumedByProposalId ?? null,
        dismissedReason: cand.dismissedReason ?? null,
        createdAt: cand.createdAt,
      })
      .onConflictDoNothing()
  }

  // ── 8. Smoke-target thread — empty, dedicated to live-LLM smoke runs.
  await ins(operatorThreads)
    .values({
      id: 'thd0smoke01',
      organizationId: organizationId,
      agentId: MERIGPT_AGENT_ID,
      createdBy: ALICE_USER_ID,
      title: 'Smoke target',
      status: 'open',
      lastTurnAt: days(30),
      createdAt: days(30),
      updatedAt: days(30),
    })
    .onConflictDoNothing()
}
