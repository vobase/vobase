/**
 * changes module seed — populates `/changes` inbox + history on every db:reset.
 *
 * Mirrors the realistic Meridian persona scenarios from messaging/seed.ts:
 *   - Pending proposals: 7 items mixing agents/learned_skill, agents/agent_memory,
 *     contacts/contact, drive/doc — covering all three `payload.kind` variants
 *     and both conversation-tied + admin-direct origins.
 *   - History rows: 4 items showing past staff decisions (approved + rejected
 *     + auto_written) so the audit trail is non-empty on a fresh DB.
 *
 * Idempotent — every insert is `ON CONFLICT DO NOTHING`.
 *
 * Cross-module: depends on contacts/seed (contact ids), agents/seed (agent ids),
 * messaging/seed (conversation ids). Order in scripts/seed.ts: AFTER messaging.
 */

import { MERIGPT_AGENT_ID } from '@modules/agents/seed'
import {
  ALICE_USER_ID,
  ELENA_CONTACT_ID,
  LIAM_CONTACT_ID,
  MARCUS_CONTACT_ID,
  MERIDIAN_ORG_ID,
  PRIYA_CONTACT_ID,
  SOPHIA_CONTACT_ID,
} from '@modules/contacts/seed'

// Conversation ids from messaging/seed — duplicated here as string literals
// because messaging/seed doesn't currently export them.
const CNV_PRIYA = 'cnv0priya0'
const CNV_MARCUS = 'cnv0marcus'
const CNV_ELENA = 'cnv0elena0'
const CNV_LIAM = 'cnv00liam0'
const CNV_DEREK = 'cnv0derek0'
const CNV_SOPHIA = 'cnv0sophia'

// Stable proposal + history ids so tests can assert against them.
export const PROP_VIP_ESC = 'prp01vipesc'
export const PROP_REFUND_POLICY = 'prp02refund'
export const PROP_GREETING_TWEAK = 'prp03greet'
export const PROP_MARCUS_PRICING = 'prp04mpric'
export const PROP_LIAM_NOTES = 'prp05lnote'
export const PROP_AGENT_MEMORY = 'prp06memry'
export const PROP_DRIVE_REFUND_POLICY = 'prp07drvrf'

export const HIST_AUTO_CONTACT_DEREK = 'hst01derek'
export const HIST_APPROVED_SLACK_LINK = 'hst02slack'
export const HIST_REJECTED_AGGRESSIVE = 'hst03aggrs'
export const HIST_AUTO_AGENT_MEM = 'hst04mem01'

interface InsertOp {
  values: (v: unknown) => { onConflictDoNothing: () => Promise<void> }
}
type Inserter = (t: unknown) => InsertOp

function hoursAgo(h: number): Date {
  return new Date(Date.now() - h * 60 * 60 * 1000)
}

export async function seed(db: unknown): Promise<void> {
  // biome-ignore lint/plugin/no-dynamic-import: seeds load schema lazily to avoid module-init-order issues (convention across modules/*/seed.ts)
  const { changeProposals, changeHistory } = await import('@modules/changes/schema')

  const d = db as { insert: Inserter }
  const ins = d.insert.bind(d)

  // ── 1. Pending proposals (these populate the /changes inbox) ───────────────

  await ins(changeProposals)
    .values({
      id: PROP_VIP_ESC,
      organizationId: MERIDIAN_ORG_ID,
      resourceModule: 'agents',
      resourceType: 'learned_skill',
      resourceId: 'escalate-vip-when-stuck',
      payload: {
        kind: 'markdown_patch',
        mode: 'replace',
        field: 'body',
        body:
          '# Escalate VIP customers when stuck\n\n' +
          'When a VIP customer (LTV ≥ $10k OR `attributes.vip = true`) mentions cancellation or churn intent **and** the agent has tried 2+ replies without resolving the underlying ask, hand off to a human supervisor with:\n\n' +
          '- Last 5 customer + agent messages, in order\n' +
          '- Customer tier + LTV (`attributes.lifetime_value`)\n' +
          '- The product feature or refund the customer is asking about\n' +
          '- Any policy citations the agent has already shown\n\n' +
          '**Do NOT** auto-apply discount codes — those require explicit staff approval through the change-proposals queue.',
      },
      status: 'pending',
      confidence: 0.83,
      proposedById: `agent:${MERIGPT_AGENT_ID}`,
      proposedByKind: 'agent',
      rationale:
        'Observed 3 VIP cases this week (Priya Raman, Liam Reyes, one un-named) where the agent looped through identical refund-window citations without escalating. Priya case escalated by Carol manually after 7 rounds.',
      expectedOutcome:
        "Once approved, I'll escalate to a supervisor on the second unresolved loop instead of the seventh. The handoff packs the last 5 messages plus tier/LTV/policy context so VIP customers hear back from a human in minutes, not hours — and Carol stops getting paged manually for cases the agent should already have flagged.",
      conversationId: CNV_PRIYA,
      createdAt: hoursAgo(0.2),
    })
    .onConflictDoNothing()

  await ins(changeProposals)
    .values({
      id: PROP_REFUND_POLICY,
      organizationId: MERIDIAN_ORG_ID,
      resourceModule: 'agents',
      resourceType: 'learned_skill',
      resourceId: 'refund-window-90-day',
      payload: {
        kind: 'markdown_patch',
        mode: 'replace',
        field: 'body',
        body:
          '## Refund window — 90 days, capped at $200\n\n' +
          'Approve refund requests automatically when ALL of the following hold:\n\n' +
          '- Purchase ≤ 90 days old (check `orders.created_at`)\n' +
          '- No prior refund on the account in the last 12 months\n' +
          '- Total refund ≤ $200\n' +
          '- Customer is NOT in the `chargeback-history` segment\n\n' +
          'For anything outside this envelope, draft the response but do NOT send — open a `refund_review` task and assign to whoever is on policy duty.',
      },
      status: 'pending',
      confidence: 0.91,
      proposedById: `agent:${MERIGPT_AGENT_ID}`,
      proposedByKind: 'agent',
      rationale:
        'Three policy-team conversations (Carol thread 2026-04-19, 2026-04-22, 2026-04-25) confirmed the 90-day window. Current behaviour skews liberal — Elena Rossi got a full refund at day 12 which was inside policy, but the agent could not cite the rule.',
      expectedOutcome:
        "Once approved, I'll auto-process refund requests that fit the envelope (≤90 days, ≤$200, no chargeback history) and quote the exact rule to the customer. Anything outside the envelope still drafts a reply but routes to whoever is on policy duty — Carol stops being the bottleneck for clean cases, and edge cases stop slipping through silently.",
      conversationId: CNV_ELENA,
      createdAt: hoursAgo(0.7),
    })
    .onConflictDoNothing()

  await ins(changeProposals)
    .values({
      id: PROP_GREETING_TWEAK,
      organizationId: MERIDIAN_ORG_ID,
      resourceModule: 'agents',
      resourceType: 'learned_skill',
      resourceId: 'opening-script-tweak',
      payload: {
        kind: 'json_patch',
        ops: [
          { op: 'replace', path: '/greeting', value: 'Hi! How can I help today?' },
          { op: 'add', path: '/closing', value: 'Thanks for reaching out — happy to help anytime.' },
          { op: 'remove', path: '/legacy_intro' },
        ],
      },
      status: 'pending',
      confidence: 0.55,
      proposedById: `staff:${ALICE_USER_ID}`,
      proposedByKind: 'user',
      rationale:
        'Three different agents proposed nearly identical wording in the last review window. Consolidating into one canonical script. Confidence low because we have not A/B tested the new opener.',
      expectedOutcome:
        'After approval, every conversation opens with the same wording across all agents — no more drift between Sentinel, Meridian, and Atlas saying the same thing three different ways. The legacy intro is removed so we stop shipping two greetings simultaneously.',
      conversationId: null,
      createdAt: hoursAgo(2),
    })
    .onConflictDoNothing()

  await ins(changeProposals)
    .values({
      id: PROP_MARCUS_PRICING,
      organizationId: MERIDIAN_ORG_ID,
      resourceModule: 'contacts',
      resourceType: 'contact',
      resourceId: MARCUS_CONTACT_ID,
      payload: {
        kind: 'field_set',
        fields: {
          segments: {
            from: ['enterprise-lead'],
            to: ['enterprise-lead', 'contract-signed', 'priority-onboarding'],
          },
          'attributes.tier': { from: 'enterprise', to: 'enterprise-plus' },
          'attributes.contract_signed_at': { from: null, to: '2026-04-26' },
          'attributes.lifetime_value': { from: 0, to: 84000 },
        },
      },
      status: 'pending',
      confidence: 0.96,
      proposedById: `agent:${MERIGPT_AGENT_ID}`,
      proposedByKind: 'agent',
      rationale:
        'Marcus confirmed signed Northwind enterprise-plus contract via DocuSign on 2026-04-26 (8 seats × $10.5k ARR ≈ $84k). Sync CRM segments, attributes, and LTV so the agent has correct routing on the next wake.',
      expectedOutcome:
        "Once applied, the next agent picking up Marcus's thread sees enterprise-plus tier and $84k ARR up front — he gets routed to a senior rep without being asked his account size again, and any refund/billing flows automatically use the enterprise SLA instead of the standard one.",
      conversationId: CNV_MARCUS,
      createdAt: hoursAgo(3),
    })
    .onConflictDoNothing()

  await ins(changeProposals)
    .values({
      id: PROP_LIAM_NOTES,
      organizationId: MERIDIAN_ORG_ID,
      resourceModule: 'contacts',
      resourceType: 'contact',
      resourceId: LIAM_CONTACT_ID,
      payload: {
        kind: 'markdown_patch',
        mode: 'append',
        field: 'notes',
        body:
          '\n- 2026-04-27: Confirmed integration with FinSight billing API; needs OAuth scope `transactions:read`. Following up on Friday with API key + sandbox credentials.\n' +
          '- Priority response window: < 2h during business hours (SGT). Pager Bob if Liam is online and no response in 90 min.',
      },
      status: 'pending',
      confidence: 0.74,
      proposedById: `agent:${MERIGPT_AGENT_ID}`,
      proposedByKind: 'agent',
      rationale:
        'Captured during conversation cnv00liam0 — staff requested explicit follow-up notes after the API integration call. Append (not replace) so prior context stays.',
      expectedOutcome:
        "After applying, anyone opening Liam's contact sees the FinSight integration follow-up plus the <2h SGT priority window. The Friday handoff with API key + sandbox creds becomes a tracked action, and Bob gets paged automatically when Liam is online and unreplied past 90min.",
      conversationId: CNV_LIAM,
      createdAt: hoursAgo(5),
    })
    .onConflictDoNothing()

  await ins(changeProposals)
    .values({
      id: PROP_AGENT_MEMORY,
      organizationId: MERIDIAN_ORG_ID,
      resourceModule: 'agents',
      resourceType: 'agent_memory',
      resourceId: MERIGPT_AGENT_ID,
      payload: {
        kind: 'markdown_patch',
        mode: 'append',
        field: 'workingMemory',
        body:
          '\n## VIP customers verified 2026-04-27\n' +
          '- Priya Raman (Acme Labs) — pro plan, $14.4k LTV, prefers Mandarin replies for code-related questions\n' +
          '- Liam Reyes (FinSight) — pro plan, integrator persona, response window <2h SGT business hours\n' +
          '- Marcus Chen (Northwind) — enterprise-plus contract signed 2026-04-26, $84k ARR\n',
      },
      status: 'pending',
      confidence: 0.78,
      proposedById: `agent:${MERIGPT_AGENT_ID}`,
      proposedByKind: 'agent',
      rationale:
        'Captured cross-conversation patterns about VIP customers. agent_memory is normally requiresApproval=false, but seeding as pending for inbox visibility — staff can approve to demonstrate the auto-write path through the decide endpoint.',
      expectedOutcome:
        "Once applied, I'll remember the three VIP customers and their preferences across every wake — Priya gets Mandarin code replies by default, Liam gets the SGT priority window, Marcus gets the enterprise-plus context. Saves them re-explaining themselves and saves staff from re-tagging segments by hand.",
      conversationId: null,
      createdAt: hoursAgo(6),
    })
    .onConflictDoNothing()

  await ins(changeProposals)
    .values({
      id: PROP_DRIVE_REFUND_POLICY,
      organizationId: MERIDIAN_ORG_ID,
      resourceModule: 'drive',
      resourceType: 'doc',
      resourceId: '/policies/refunds.md',
      payload: {
        kind: 'markdown_patch',
        mode: 'replace',
        field: 'content',
        body:
          '# Meridian Refund Policy\n\n' +
          '## Standard window\n- Digital goods: 14 days from purchase\n- Physical goods: 30 days from delivery\n- Subscriptions: pro-rated for the unused period in the current billing cycle\n\n' +
          '## Exceptions\n- VIP customers (LTV ≥ $10k): full refund up to 90 days, no questions asked\n- Chargeback history: refund denied; escalate to Carol\n- Multi-seat enterprise contracts: refund window per the signed MSA, not this policy\n\n' +
          '## Approval routing\n- ≤ $200 → agent auto-approves\n- $200 – $1000 → on-call staff member\n- > $1000 → Carol or Alice\n',
      },
      status: 'pending',
      confidence: 0.88,
      proposedById: `agent:${MERIGPT_AGENT_ID}`,
      proposedByKind: 'agent',
      rationale:
        'Drafted by Sentinel after the policy team session 2026-04-25. Replaces the legacy refunds.md which only covered digital goods. Drive write is staged via the changes umbrella so staff can review before publish.',
      expectedOutcome:
        'Once published, refunds.md becomes the single policy file every agent cites for refund questions. The legacy digital-only version is replaced — VIP, multi-seat enterprise, and chargeback-history paths all live in one place, and agents stop quoting the old 14-day-everything rule for cases that should route to a human.',
      conversationId: null,
      createdAt: hoursAgo(8),
    })
    .onConflictDoNothing()

  // ── 2. History rows (audit trail — non-empty on fresh DB) ──────────────────

  await ins(changeHistory)
    .values({
      id: HIST_AUTO_CONTACT_DEREK,
      organizationId: MERIDIAN_ORG_ID,
      resourceModule: 'contacts',
      resourceType: 'contact',
      resourceId: 'ctt0derek0',
      payload: {
        kind: 'field_set',
        fields: {
          segments: { from: ['new-signup'], to: ['new-signup', 'self-serve-onboarded'] },
          'attributes.last_login_at': { from: null, to: '2026-04-26T09:14:00Z' },
        },
      },
      before: { segments: ['new-signup'], attributes: {} },
      after: {
        segments: ['new-signup', 'self-serve-onboarded'],
        attributes: { last_login_at: '2026-04-26T09:14:00Z' },
      },
      changedBy: MERIGPT_AGENT_ID,
      changedByKind: 'agent',
      appliedProposalId: null,
      createdAt: hoursAgo(20),
    })
    .onConflictDoNothing()

  await ins(changeHistory)
    .values({
      id: HIST_APPROVED_SLACK_LINK,
      organizationId: MERIDIAN_ORG_ID,
      resourceModule: 'agents',
      resourceType: 'learned_skill',
      resourceId: 'slack-routing-link',
      payload: {
        kind: 'markdown_patch',
        mode: 'replace',
        field: 'body',
        body:
          '# Slack routing for staff handoffs\n\n' +
          'When handing off to staff, post a Slack thread to #cs-meridian with the conversation deep-link and a 3-bullet summary.',
      },
      before: null,
      after: { id: 'lsk0sla001', name: 'slack-routing-link' },
      changedBy: 'usr0alice0',
      changedByKind: 'user',
      appliedProposalId: 'lpr0app001',
      createdAt: hoursAgo(48),
    })
    .onConflictDoNothing()

  await ins(changeHistory)
    .values({
      id: HIST_REJECTED_AGGRESSIVE,
      organizationId: MERIDIAN_ORG_ID,
      resourceModule: 'agents',
      resourceType: 'learned_skill',
      resourceId: 'aggressive-upsell',
      payload: {
        kind: 'markdown_patch',
        mode: 'replace',
        field: 'body',
        body: 'Always end every conversation with a Pro-tier upsell offer.',
      },
      before: null,
      after: null,
      changedBy: 'usr0alice0',
      changedByKind: 'user',
      appliedProposalId: 'lpr0rej001',
      createdAt: hoursAgo(72),
    })
    .onConflictDoNothing()

  await ins(changeHistory)
    .values({
      id: HIST_AUTO_AGENT_MEM,
      organizationId: MERIDIAN_ORG_ID,
      resourceModule: 'agents',
      resourceType: 'agent_memory',
      resourceId: MERIGPT_AGENT_ID,
      payload: {
        kind: 'markdown_patch',
        mode: 'append',
        field: 'workingMemory',
        body: '\n- 2026-04-25: Stale-triage swept 8 conversations; 3 escalated to staff queue.',
      },
      before: '',
      after: '\n- 2026-04-25: Stale-triage swept 8 conversations; 3 escalated to staff queue.',
      changedBy: MERIGPT_AGENT_ID,
      changedByKind: 'agent',
      appliedProposalId: null,
      createdAt: hoursAgo(40),
    })
    .onConflictDoNothing()

  // Touch unused imports so biome's unused-import sweep doesn't strip them
  // — these IDs are exported above for tests but not used in the seed body itself.
  void ELENA_CONTACT_ID
  void PRIYA_CONTACT_ID
  void SOPHIA_CONTACT_ID
  void CNV_DEREK
  void CNV_SOPHIA
}
