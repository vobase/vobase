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
import { ALICE_USER_ID, BOB_USER_ID, CAROL_USER_ID, MERIDIAN_ORG_ID } from '@modules/contacts/seed'

export { MERIDIAN_ORG_ID }

/** Stable agent ID — the single Meridian-org agent. */
export const MERIGPT_AGENT_ID = 'agt0meri0v1'

/** Conversation IDs from messaging/seed — referenced here so scores anchor to real threads. */
const PRIYA_CONV_ID = 'cnv0priya0'
const MARCUS_CONV_ID = 'cnv0marcus'
const ELENA_CONV_ID = 'cnv0elena0'
const DEREK_CONV_ID = 'cnv0derek0'

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
- Bug reports → ask for repro steps, then \`add_note\` mentioning **bob** with the repro + plan.
- Enterprise procurement → \`add_note\` mentioning **alice**.
- Anything else outside your authority (visit notices, callbacks, edge-case policy) → \`add_note\` with the right teammate in \`mentions\`. Never refuse a customer with "I can't notify staff".

## Operator-lane rules

- **Daily brief** (08:00 SGT weekdays): summarise the past 24h — resolved count, open + idle > 24h, pending learning proposals, pending approvals, refund volume vs the rolling 7-day average.
- **Stale-triage** (every 15 min): for each conversation idle > 24h, post a card asking the assignee how to proceed.
- **Ad-hoc operator questions**: answer directly in the thread. Numbers and links over prose.

## Guardrails

- Never promise a feature that's not in \`/drive/BUSINESS.md#Products\`.
- Never commit to a specific delivery date.
- Never compare against competitors by name.
- If unsure of a policy, \`grep -r <topic> /drive/\` before answering.`

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

export async function seed(db: unknown): Promise<void> {
  // biome-ignore lint/plugin/no-dynamic-import: seeds load schema lazily to avoid module-init-order issues (convention across modules/*/seed.ts)
  const agentsSchema = await import('@modules/agents/schema')
  const { agentDefinitions, agentScores, agentStaffMemory, agentThreadMessages, agentThreads, learnedSkills } =
    agentsSchema
  // biome-ignore lint/plugin/no-dynamic-import: seeds load schema lazily to avoid module-init-order issues (convention across modules/*/seed.ts)
  const { agentSchedules } = await import('@modules/schedules/schema')

  const d = db as { insert: Inserter }
  const ins = d.insert.bind(d)

  // ── 1. Agent definition — single MeriGPT for the Meridian org ───────
  await ins(agentDefinitions)
    .values({
      id: MERIGPT_AGENT_ID,
      organizationId: MERIDIAN_ORG_ID,
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
  await ins(agentSchedules)
    .values({
      id: 'sch0bri0v1',
      organizationId: MERIDIAN_ORG_ID,
      agentId: MERIGPT_AGENT_ID,
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
      agentId: MERIGPT_AGENT_ID,
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
      organizationId: MERIDIAN_ORG_ID,
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
        '3. If yes — proceed with the action. If no — escalate. If edge case — `add_note` mentioning the right teammate.',
        '',
        'Floating across the org: any agent that picks up `/drive/BUSINESS.md` should follow this rubric.',
      ].join('\n'),
      tags: ['policy', 'org-wide'],
      version: 1,
      parentProposalId: null,
      createdAt: days(2),
    })
    .onConflictDoNothing()

  // ── 4. Agent staff memory — what MeriGPT knows about each staff member ──
  await ins(agentStaffMemory)
    .values({
      id: 'asm0alice0',
      organizationId: MERIDIAN_ORG_ID,
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
      organizationId: MERIDIAN_ORG_ID,
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
      organizationId: MERIDIAN_ORG_ID,
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

  // ── 6. Operator threads — Alice + Carol working with MeriGPT ────────
  await ins(agentThreads)
    .values({
      id: 'thd0brfgi1',
      organizationId: MERIDIAN_ORG_ID,
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

  // ── 7. Smoke-target thread — empty, dedicated to live-LLM smoke runs.
  await ins(agentThreads)
    .values({
      id: 'thd0smoke01',
      organizationId: MERIDIAN_ORG_ID,
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
