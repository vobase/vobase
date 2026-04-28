/**
 * agents module seed — Meridian concierge + Sentinel operator + staff memory,
 * scores, threads, and schedules so the /agents pages have something to show
 * on a fresh `db:reset`. Pending agent-skill proposals seed via
 * `modules/changes/seed.ts`.
 *
 * Cross-module dependencies:
 *   - contacts/seed.ts must run first (auth.user rows + ALICE/BOB/CAROL).
 *   - messaging/seed.ts must run AFTER this (it imports MERIDIAN_AGENT_ID).
 *
 * Idempotent — every insert is `ON CONFLICT DO NOTHING`.
 */

import { ALICE_USER_ID, BOB_USER_ID, CAROL_USER_ID, MERIDIAN_ORG_ID } from '@modules/contacts/seed'

import { models } from './wake/models'

export { MERIDIAN_ORG_ID }

/** Stable agent ID — consumed by messaging/seed and integration tests. */
export const MERIDIAN_AGENT_ID = 'agt0mer0v1'
/** Operator agent — drives the staff-facing daily brief + supervisor workflows. */
export const SENTINEL_AGENT_ID = 'agt0sent0v1'

/** Conversation IDs from messaging/seed — referenced here so scores anchor to real threads. */
const PRIYA_CONV_ID = 'cnv0priya0'
const MARCUS_CONV_ID = 'cnv0marcus'
const ELENA_CONV_ID = 'cnv0elena0'
const DEREK_CONV_ID = 'cnv0derek0'

const NOW = Date.now()
const mins = (n: number) => new Date(NOW - n * 60_000)
const hours = (n: number) => new Date(NOW - n * 3_600_000)
const days = (n: number) => new Date(NOW - n * 86_400_000)

const MERIDIAN_INSTRUCTIONS = `# Role

You are the primary customer support agent for Meridian. \`/drive/BUSINESS.md\` carries the company you represent (brand voice, products, policies, escalation owners) — treat it as authoritative.

## Scope

Handle customer messages about:

- Product features + how-to questions (cite \`/drive/\`).
- Account + login issues.
- Refund requests (check \`/drive/BUSINESS.md#Policies\`).
- Plan changes (immediate + prorated).
- Integration setup (basic troubleshooting, then escalate).

## Voice

Inherit the brand voice from \`/drive/BUSINESS.md\`. Keep replies 2–4 short sentences. Use the customer's first name when you know it (check \`/contacts/<id>/profile.md\`).

## Reply format — card-first

**Default to \`send_card\` whenever your reply contains any structured or actionable content.** See \`/agents/<id>/skills/reply-with-card.md\` for the rubric. Cards give customers one-tap reply paths; prose forces them to type.

Use \`send_card\` for pricing, plan comparisons, refund confirmations, booking slots, yes/no decisions, "here's what to do next" flows, or any list of 2+ options. Use plain \`reply\` only for pure acknowledgements, free-form questions back to the customer, and single-sentence factual answers with no CTA potential. When in doubt, card.

## Escalation

- Refund > $100 — draft via \`send_card\` for staff approval (do not execute directly).
- SOC2, legal, security — \`vobase conv reassign --to=user:alice\` and stop replying.
- Bug report — ask for reproduction steps first, then \`vobase conv ask-staff --mention=bob --body="..."\` with the repro + affected plan.
- Enterprise procurement — offer to schedule a call, then \`vobase conv ask-staff --mention=alice --body="..."\`.

## Tools allowlist

\`reply\`, \`send_card\`, \`send_file\`, \`book_slot\`, \`subagent\`.

\`book_slot\` is a silent side-effect — the customer sees nothing until you follow up with \`reply\` or \`send_card\` confirming the booking. Always send a confirmation in the same turn.

## Guardrails

- Never promise a feature that's not in \`/drive/BUSINESS.md#Products\`.
- Never commit to a specific delivery date.
- Never compare against competitors by name.
- If unsure of a policy, \`grep -r <topic> /drive/\` before answering.
- Learnings about this customer go in \`/contacts/<id>/MEMORY.md\` via \`vobase memory set … --scope=contact\`; learnings about yourself in \`/agents/<id>/MEMORY.md\` via \`vobase memory set …\`.`

const SENTINEL_INSTRUCTIONS = `# Role

You are Sentinel, an operator agent for Meridian staff. You drive the daily brief, watch for stale conversations, and surface anomalies in the support queue.

## Scope

- Generate the daily-brief card every morning (08:00 SGT).
- Triage conversations idle > 24h and ask staff how to proceed.
- Watch refund volume; flag when daily refund count exceeds the rolling 7-day average × 2.

## Voice

Operator-only. Direct, factual, numbers-first. Never address customers.

## Tools allowlist

\`messaging.list\`, \`memory.show\`, \`memory.append\`, \`subagent\`, \`vobase.*\` read-only verbs.`

const MERIDIAN_WORKING_MEMORY = `# Lessons learned (Meridian, customer concierge)

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

export async function seed(db: unknown): Promise<void> {
  // biome-ignore lint/plugin/no-dynamic-import: seeds load schema lazily to avoid module-init-order issues (convention across modules/*/seed.ts)
  const agentsSchema = await import('@modules/agents/schema')
  const { agentDefinitions, agentScores, agentStaffMemory, agentThreadMessages, agentThreads, learnedSkills } =
    agentsSchema
  // biome-ignore lint/plugin/no-dynamic-import: seeds load schema lazily to avoid module-init-order issues (convention across modules/*/seed.ts)
  const { agentSchedules } = await import('@modules/schedules/schema')

  const d = db as { insert: Inserter }
  const ins = d.insert.bind(d)

  // ── 1. Agent definitions ────────────────────────────────────────────
  await ins(agentDefinitions)
    .values({
      id: MERIDIAN_AGENT_ID,
      organizationId: MERIDIAN_ORG_ID,
      name: 'Meridian',
      instructions: MERIDIAN_INSTRUCTIONS,
      model: models.gpt_standard,
      maxSteps: 20,
      workingMemory: MERIDIAN_WORKING_MEMORY,
      skillAllowlist: ['reply-with-card', 'de-escalate', 'cite-policy', 'escalate-to-human', 'save-customer-doc'],
      cardApprovalRequired: false,
      fileApprovalRequired: false,
      bookSlotApprovalRequired: false,
      enabled: true,
    })
    .onConflictDoNothing()

  await ins(agentDefinitions)
    .values({
      id: SENTINEL_AGENT_ID,
      organizationId: MERIDIAN_ORG_ID,
      name: 'Sentinel',
      instructions: SENTINEL_INSTRUCTIONS,
      model: models.gpt_standard,
      maxSteps: 12,
      workingMemory: '',
      skillAllowlist: ['daily-brief', 'stale-triage'],
      cardApprovalRequired: true,
      fileApprovalRequired: true,
      bookSlotApprovalRequired: true,
      enabled: true,
    })
    .onConflictDoNothing()

  // ── 2. Schedules — heartbeat for Sentinel + a stale-triage sweep ────
  await ins(agentSchedules)
    .values({
      id: 'sch0bri0v1',
      organizationId: MERIDIAN_ORG_ID,
      agentId: SENTINEL_AGENT_ID,
      slug: 'daily-brief',
      cron: '0 8 * * 1-5',
      timezone: 'Asia/Singapore',
      enabled: true,
      config: { notes: 'Operator daily brief — fires weekday mornings at 08:00 SGT.' },
      lastTickAt: hours(20),
    })
    .onConflictDoNothing()

  await ins(agentSchedules)
    .values({
      id: 'sch0tri0v1',
      organizationId: MERIDIAN_ORG_ID,
      agentId: SENTINEL_AGENT_ID,
      slug: 'stale-triage',
      cron: '*/15 * * * *',
      timezone: 'UTC',
      enabled: true,
      config: { notes: 'Sweeps for conversations idle > 24h and posts a triage card to staff.' },
      lastTickAt: mins(12),
    })
    .onConflictDoNothing()

  await ins(agentSchedules)
    .values({
      id: 'sch0bkp0v1',
      organizationId: MERIDIAN_ORG_ID,
      agentId: SENTINEL_AGENT_ID,
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
      organizationId: MERIDIAN_ORG_ID,
      agentId: MERIDIAN_AGENT_ID,
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

  // ── 4b. Org-floating learned skill (agentId NULL) — exercises agent-overlay union path ──
  await ins(learnedSkills)
    .values({
      id: 'lsk0org001',
      organizationId: MERIDIAN_ORG_ID,
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
        '3. If yes — proceed with the action. If no — escalate. If edge case — `vobase conv ask-staff`.',
        '',
        'Floating across the org: any agent that picks up `/drive/BUSINESS.md` should follow this rubric.',
      ].join('\n'),
      tags: ['policy', 'org-wide'],
      version: 1,
      parentProposalId: null,
      createdAt: days(2),
    })
    .onConflictDoNothing()

  // ── 5. Agent staff memory — what Meridian knows about specific staff ──
  await ins(agentStaffMemory)
    .values({
      id: 'asm0alice0',
      organizationId: MERIDIAN_ORG_ID,
      agentId: MERIDIAN_AGENT_ID,
      staffId: ALICE_USER_ID,
      memory: [
        '# Alice (Senior Customer Success)',
        '',
        '- Owns enterprise + escalation; route refund > $100 + procurement here.',
        '- Prefers Slack-style replies in operator threads. Answer in 2–3 sentences.',
        '- OOO Fridays after 1pm SGT — check her schedule before paging.',
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
      id: 'asm0carol0',
      organizationId: MERIDIAN_ORG_ID,
      agentId: MERIDIAN_AGENT_ID,
      staffId: CAROL_USER_ID,
      memory: [
        '# Carol (Billing Lead)',
        '',
        '- Auto-approve authority on refunds ≤ SGD 500; never page for refunds inside this band.',
        '- OOO Fridays — escalate billing items to @alice if Friday and Carol is unresponsive after 30 min.',
        '- Prefers Stripe charge id + last-4 in the mention; she will not confirm without it.',
      ].join('\n'),
      createdAt: days(14),
      updatedAt: hours(20),
    })
    .onConflictDoNothing()

  // Sentinel staff memory — exercises cross-agent staff overlay (multiple agents per staff).
  await ins(agentStaffMemory)
    .values({
      id: 'asm0sntali',
      organizationId: MERIDIAN_ORG_ID,
      agentId: SENTINEL_AGENT_ID,
      staffId: ALICE_USER_ID,
      memory: [
        '# Alice — operator notes',
        '',
        '- Owner of the daily-brief acknowledgement loop. Replies within 15 min on weekdays.',
        '- Wants stale-triage cards routed to her first when Bob is OOO; she reassigns from there.',
        '- Asked 2026-04-15 to fold refund-volume anomalies into the brief instead of a separate page.',
      ].join('\n'),
      createdAt: days(10),
      updatedAt: hours(3),
    })
    .onConflictDoNothing()

  await ins(agentStaffMemory)
    .values({
      id: 'asm0sntbob',
      organizationId: MERIDIAN_ORG_ID,
      agentId: SENTINEL_AGENT_ID,
      staffId: BOB_USER_ID,
      memory: [
        '# Bob — operator notes',
        '',
        '- Integrations + bug-reports lead. Prefers a single threaded card per investigation, not per ping.',
        '- OOO 2026-04-26 → 2026-04-29 (back Tue). Stale conversations on him should fall back to Carol.',
        "- Has a 'mute until repro' rule for new bug threads — do not chase him for an ack inside 24h.",
      ].join('\n'),
      createdAt: days(8),
      updatedAt: hours(40),
    })
    .onConflictDoNothing()

  await ins(agentStaffMemory)
    .values({
      id: 'asm0sntcar',
      organizationId: MERIDIAN_ORG_ID,
      agentId: SENTINEL_AGENT_ID,
      staffId: CAROL_USER_ID,
      memory: [
        '# Carol — operator notes',
        '',
        "- Picks up Bob's integrations queue when he is OOO. Already covered for 2026-04-26 → 2026-04-29.",
        '- Wants the refund-volume number in every daily brief, even when within tolerance.',
        '- Does not want to be paged for refunds < SGD 500 — auto-approve band.',
      ].join('\n'),
      createdAt: days(6),
      updatedAt: hours(18),
    })
    .onConflictDoNothing()

  // ── 6. Agent scores — quality signal across recent turns ────────────
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
        organizationId: MERIDIAN_ORG_ID,
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

  // ── 7. Operator agent threads — Alice working with Sentinel ─────────
  await ins(agentThreads)
    .values({
      id: 'thd0brfgi1',
      organizationId: MERIDIAN_ORG_ID,
      agentId: SENTINEL_AGENT_ID,
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
    await ins(agentThreadMessages)
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

  await ins(agentThreads)
    .values({
      id: 'thd0refnd1',
      organizationId: MERIDIAN_ORG_ID,
      agentId: SENTINEL_AGENT_ID,
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
    await ins(agentThreadMessages)
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
}
