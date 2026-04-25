/**
 * messaging module seed — realistic scenarios across all conversation statuses.
 *
 * Exports `SEEDED_CONV_ID` (stable) for integration tests; all other
 * conversations/messages/notes/approvals are fixed-id inserts with
 * ON CONFLICT DO NOTHING for idempotent `bun run db:reset` runs.
 *
 * Scenarios:
 *   1. Test Customer  — baseline empty conv (integration-test stable id)
 *   2. Priya          — active, 4-message thread, agent card + card_reply
 *   3. Marcus         — awaiting_approval, staff-mentioned note, pending send_card
 *   4. Elena          — active, assigned to Carol, 2 internal notes, pending refund card
 *   5. Derek          — resolved, short two-message history
 *   6. Sophia         — active, customer question waiting on agent
 */

import { MERIDIAN_AGENT_ID } from '@modules/agents/seed'
import {
  ALICE_USER_ID,
  BOB_USER_ID,
  CAROL_USER_ID,
  CUSTOMER_CHANNEL_INSTANCE_ID,
  DEREK_CONTACT_ID,
  ELENA_CONTACT_ID,
  MARCUS_CONTACT_ID,
  MERIDIAN_ORG_ID,
  PRIYA_CONTACT_ID,
  SEEDED_CONTACT_ID,
  SOPHIA_CONTACT_ID,
  WEB_CHANNEL_INSTANCE_ID,
} from '@modules/contacts/seed'
import { conversations, internalNotes, messages, pendingApprovals } from '@modules/messaging/schema'
import { conversationEvents } from '@vobase/core'

export type { MERIDIAN_ORG_ID, SEEDED_CONTACT_ID }

/** Stable conversation ID — imported by integration tests and Lane F test-harness. */
export const SEEDED_CONV_ID = 'cnv0test00'

export const PRIYA_CONV_ID = 'cnv0priya0'
export const PRIYA_WA_CONV_ID = 'cnv0priyawa'
export const MARCUS_CONV_ID = 'cnv0marcus'
export const ELENA_CONV_ID = 'cnv0elena0'
export const ELENA_WEB_CONV_ID = 'cnv0elenweb'
export const DEREK_CONV_ID = 'cnv0derek0'
export const SOPHIA_CONV_ID = 'cnv0sophia'

const AGENT_ASSIGNEE = `agent:${MERIDIAN_AGENT_ID}`
const NOW = Date.now()
const mins = (n: number) => new Date(NOW - n * 60_000)

interface InsertOp {
  values: (v: unknown) => { onConflictDoNothing: () => Promise<void> }
}
type Inserter = (t: unknown) => InsertOp

async function insertConv(
  insert: Inserter,
  row: {
    id: string
    contactId: string
    channelInstanceId: string
    status: string
    assignee: string
    lastMessageAt: Date
    resolvedAt?: Date
    resolvedReason?: string
  },
) {
  await insert(conversations)
    .values({
      id: row.id,
      organizationId: MERIDIAN_ORG_ID,
      contactId: row.contactId,
      channelInstanceId: row.channelInstanceId,
      status: row.status,
      assignee: row.assignee,
      lastMessageAt: row.lastMessageAt,
      resolvedAt: row.resolvedAt,
      resolvedReason: row.resolvedReason,
    })
    .onConflictDoNothing()
}

async function insertMsg(
  insert: Inserter,
  row: {
    id: string
    conversationId: string
    role: 'customer' | 'agent' | 'system' | 'staff'
    kind: 'text' | 'card' | 'card_reply' | 'image'
    content: unknown
    parentMessageId?: string | null
    channelExternalId?: string | null
    status?: string | null
    createdAt: Date
  },
) {
  await insert(messages)
    .values({
      id: row.id,
      conversationId: row.conversationId,
      organizationId: MERIDIAN_ORG_ID,
      role: row.role,
      kind: row.kind,
      content: row.content,
      parentMessageId: row.parentMessageId ?? null,
      channelExternalId: row.channelExternalId ?? null,
      status: row.status ?? null,
      createdAt: row.createdAt,
    })
    .onConflictDoNothing()
}

async function insertNote(
  insert: Inserter,
  row: {
    id: string
    conversationId: string
    authorType: 'agent' | 'staff' | 'system'
    authorId: string
    body: string
    mentions?: string[]
    createdAt: Date
  },
) {
  await insert(internalNotes)
    .values({
      id: row.id,
      organizationId: MERIDIAN_ORG_ID,
      conversationId: row.conversationId,
      authorType: row.authorType,
      authorId: row.authorId,
      body: row.body,
      mentions: row.mentions ?? [],
      createdAt: row.createdAt,
    })
    .onConflictDoNothing()
}

async function insertActivity(
  insert: Inserter,
  row: {
    conversationId: string
    type: string
    payload: Record<string, unknown>
    ts: Date
  },
) {
  await insert(conversationEvents)
    .values({
      conversationId: row.conversationId,
      organizationId: MERIDIAN_ORG_ID,
      wakeId: null,
      turnIndex: 0,
      ts: row.ts,
      type: row.type,
      payload: row.payload,
    })
    .onConflictDoNothing()
}

async function insertApproval(
  insert: Inserter,
  row: {
    id: string
    conversationId: string
    toolName: string
    toolArgs: unknown
    status?: string
    createdAt: Date
  },
) {
  await insert(pendingApprovals)
    .values({
      id: row.id,
      organizationId: MERIDIAN_ORG_ID,
      conversationId: row.conversationId,
      toolName: row.toolName,
      toolArgs: row.toolArgs,
      status: row.status ?? 'pending',
      createdAt: row.createdAt,
    })
    .onConflictDoNothing()
}

export async function seed(db: unknown): Promise<void> {
  const d = db as { insert: Inserter }
  const ins = d.insert.bind(d)

  // ── 1. Test Customer (baseline, empty) ──────────────────────────────
  await insertConv(ins, {
    id: SEEDED_CONV_ID,
    contactId: SEEDED_CONTACT_ID,
    channelInstanceId: CUSTOMER_CHANNEL_INSTANCE_ID,
    status: 'active',
    assignee: AGENT_ASSIGNEE,
    lastMessageAt: mins(240),
  })

  // ── 2. Priya — active; customer asked about Slack integration; agent sent card ──
  await insertConv(ins, {
    id: PRIYA_CONV_ID,
    contactId: PRIYA_CONTACT_ID,
    channelInstanceId: WEB_CHANNEL_INSTANCE_ID,
    status: 'active',
    assignee: AGENT_ASSIGNEE,
    lastMessageAt: mins(8),
  })
  await insertMsg(ins, {
    id: 'msg0priya01',
    conversationId: PRIYA_CONV_ID,
    role: 'customer',
    kind: 'text',
    content: {
      text: "Hey — can Slack notifications be filtered by project? Right now we get every task event and it's noisy.",
    },
    channelExternalId: 'web-priya-01',
    createdAt: mins(35),
  })
  await insertMsg(ins, {
    id: 'msg0priya02',
    conversationId: PRIYA_CONV_ID,
    role: 'agent',
    kind: 'text',
    content: {
      text: 'Hi Priya — yes, filters are per-channel. You pick which project events route to which Slack channel under Settings → Integrations → Slack → Routing. Want me to show the options?',
    },
    status: 'delivered',
    createdAt: mins(34),
  })
  await insertMsg(ins, {
    id: 'msg0priya03',
    conversationId: PRIYA_CONV_ID,
    role: 'agent',
    kind: 'card',
    content: {
      card: {
        type: 'card',
        title: 'Slack routing options',
        children: [
          { type: 'text', style: 'body', content: 'Choose the scope you want to filter on:' },
          {
            type: 'actions',
            buttons: [
              { id: 'route-project', label: 'By project', value: 'project' },
              { id: 'route-tag', label: 'By tag', value: 'tag' },
              { id: 'route-person', label: 'By assignee', value: 'assignee' },
            ],
          },
        ],
      },
    },
    status: 'read',
    createdAt: mins(34),
  })
  await insertMsg(ins, {
    id: 'msg0priya04',
    conversationId: PRIYA_CONV_ID,
    role: 'customer',
    kind: 'card_reply',
    content: { buttonId: 'route-project', buttonValue: 'project', buttonLabel: 'By project' },
    parentMessageId: 'msg0priya03',
    channelExternalId: 'web-priya-04',
    createdAt: mins(8),
  })

  // ── 2b. Priya — second conversation on WhatsApp (short follow-up) ──
  await insertConv(ins, {
    id: PRIYA_WA_CONV_ID,
    contactId: PRIYA_CONTACT_ID,
    channelInstanceId: CUSTOMER_CHANNEL_INSTANCE_ID,
    status: 'active',
    assignee: AGENT_ASSIGNEE,
    lastMessageAt: mins(45),
  })
  await insertMsg(ins, {
    id: 'msg0priywa1',
    conversationId: PRIYA_WA_CONV_ID,
    role: 'customer',
    kind: 'text',
    content: { text: 'Ping over WA — quick one: can I forward Slack alerts to my phone during on-call?' },
    channelExternalId: 'wa-priya-01',
    createdAt: mins(50),
  })
  await insertMsg(ins, {
    id: 'msg0priywa2',
    conversationId: PRIYA_WA_CONV_ID,
    role: 'agent',
    kind: 'text',
    content: {
      text: "Yes — Slack's own mobile app handles that best. In our dashboard you can also set a per-user WhatsApp fallback under Notifications → Escalation. Want me to walk you through it?",
      failureReason: 'WhatsApp rejected message: 24h window expired — send a template instead.',
    },
    status: 'failed',
    createdAt: mins(45),
  })

  // ── 3. Marcus — awaiting_approval; enterprise quote drafted, waiting on Alice ──
  await insertConv(ins, {
    id: MARCUS_CONV_ID,
    contactId: MARCUS_CONTACT_ID,
    channelInstanceId: WEB_CHANNEL_INSTANCE_ID,
    status: 'awaiting_approval',
    assignee: AGENT_ASSIGNEE,
    lastMessageAt: mins(55),
  })
  await insertMsg(ins, {
    id: 'msg0marc001',
    conversationId: MARCUS_CONV_ID,
    role: 'customer',
    kind: 'text',
    content: {
      text: "Hi — we're ~400 people, SG HQ. Need pricing for Enterprise + your SOC 2 report. Can you share a deck or quote?",
    },
    channelExternalId: 'web-marcus-01',
    createdAt: mins(120),
  })
  await insertMsg(ins, {
    id: 'msg0marc002',
    conversationId: MARCUS_CONV_ID,
    role: 'agent',
    kind: 'text',
    content: {
      text: "Hi Marcus — happy to help. For 400 seats our Enterprise tier usually lands around $19–21/user/month on an annual commitment, plus SSO/SAML, audit log, dedicated CSM, and our SOC 2 Type II report on request. I've drafted a formal quote card for Alice (our Head of CS) to review before I send it over.",
    },
    createdAt: mins(58),
  })
  await insertNote(ins, {
    id: 'not0marc001',
    conversationId: MARCUS_CONV_ID,
    authorType: 'agent',
    authorId: MERIDIAN_AGENT_ID,
    body: '@alice — 400-seat Enterprise inquiry from Northwind. Drafted quote at $20/user/mo (annual) with SOC 2. Requesting approval before sending.',
    mentions: [ALICE_USER_ID],
    createdAt: mins(57),
  })
  await insertApproval(ins, {
    id: 'pnd0marc001',
    conversationId: MARCUS_CONV_ID,
    toolName: 'send_card',
    toolArgs: {
      card: {
        type: 'card',
        title: 'Meridian Enterprise — Proposed Quote',
        children: [
          { type: 'text', style: 'heading', content: 'Northwind · 400 seats · annual' },
          {
            type: 'fields',
            items: [
              { label: 'Per user', value: '$20 / month' },
              { label: 'Annual total', value: '$96,000' },
              { label: 'Includes', value: 'SSO/SAML, audit log, SOC 2, dedicated CSM' },
              { label: 'Term', value: '12 months, net-30' },
            ],
          },
          {
            type: 'actions',
            buttons: [
              { id: 'quote-accept', label: 'Looks good — send formal contract', value: 'accept' },
              { id: 'quote-discuss', label: 'Discuss on a call', value: 'call' },
            ],
          },
        ],
      },
    },
    createdAt: mins(57),
  })

  // ── 4. Elena — active, reassigned to Carol, refund flow with 2 notes + pending ──
  await insertConv(ins, {
    id: ELENA_CONV_ID,
    contactId: ELENA_CONTACT_ID,
    channelInstanceId: CUSTOMER_CHANNEL_INSTANCE_ID,
    status: 'active',
    assignee: `user:${CAROL_USER_ID}`,
    lastMessageAt: mins(22),
  })
  await insertMsg(ins, {
    id: 'msg0elen001',
    conversationId: ELENA_CONV_ID,
    role: 'customer',
    kind: 'text',
    content: {
      text: "I'd like a refund for my Pro plan. I signed up 12 days ago and it's not the right fit for my studio.",
    },
    channelExternalId: 'wa-elena-01',
    createdAt: mins(180),
  })
  await insertMsg(ins, {
    id: 'msg0elen002',
    conversationId: ELENA_CONV_ID,
    role: 'agent',
    kind: 'text',
    content: {
      text: "Hi Elena — sorry it didn't work out. You're inside the 14-day window so a full refund is on the table. I'm looping in Carol from our billing team to confirm and process it today.",
    },
    createdAt: mins(178),
  })
  await insertNote(ins, {
    id: 'not0elen001',
    conversationId: ELENA_CONV_ID,
    authorType: 'agent',
    authorId: MERIDIAN_AGENT_ID,
    body: '@carol — refund request from Elena (Pro, 1 seat, paid 12 days ago). Within 14-day window, no usage anomalies. Recommend full refund.',
    mentions: [CAROL_USER_ID],
    createdAt: mins(177),
  })
  await insertActivity(ins, {
    conversationId: ELENA_CONV_ID,
    type: 'conversation.reassigned',
    payload: { from: AGENT_ASSIGNEE, to: `user:${CAROL_USER_ID}`, reason: 'billing escalation', by: MERIDIAN_AGENT_ID },
    ts: mins(176),
  })
  await insertNote(ins, {
    id: 'not0elen002',
    conversationId: ELENA_CONV_ID,
    authorType: 'staff',
    authorId: CAROL_USER_ID,
    body: "Confirmed in Stripe — charge $12.00 on 2026-04-07. I'll approve the refund card once the agent drafts it; let's include a 14-day snoozed discount offer in case she wants to return later.",
    mentions: [],
    createdAt: mins(60),
  })
  // Alice is the dev-login staff — authored note demonstrates "mine on right".
  await insertNote(ins, {
    id: 'not0elen003',
    conversationId: ELENA_CONV_ID,
    authorType: 'staff',
    authorId: ALICE_USER_ID,
    body: "+1 on Carol's plan. Looping off — I'll draft the comeback-discount copy and hand back once the refund lands.",
    mentions: [],
    createdAt: mins(45),
  })
  await insertMsg(ins, {
    id: 'msg0elen003',
    conversationId: ELENA_CONV_ID,
    role: 'customer',
    kind: 'text',
    content: { text: 'Thanks — any idea how long the refund takes to show up on my card?' },
    channelExternalId: 'wa-elena-03',
    createdAt: mins(22),
  })
  await insertApproval(ins, {
    id: 'pnd0elen001',
    conversationId: ELENA_CONV_ID,
    toolName: 'send_card',
    toolArgs: {
      card: {
        type: 'card',
        title: 'Refund confirmation',
        children: [
          { type: 'text', content: 'Full refund of $12.00 has been queued. Funds usually land in 3–5 business days.' },
          {
            type: 'fields',
            items: [
              { label: 'Amount', value: '$12.00 USD' },
              { label: 'Method', value: 'Original card (·· 4242)' },
              { label: 'Reference', value: 'refund_elena_20260418' },
            ],
          },
          {
            type: 'actions',
            buttons: [
              { id: 'refund-ack', label: 'Got it, thanks', value: 'ack' },
              { id: 'refund-discount', label: "I'd like the 20% comeback offer", value: 'comeback' },
            ],
          },
        ],
      },
    },
    createdAt: mins(21),
  })

  // ── 4b. Elena — second conversation on Web (billing portal follow-up) ──
  await insertConv(ins, {
    id: ELENA_WEB_CONV_ID,
    contactId: ELENA_CONTACT_ID,
    channelInstanceId: WEB_CHANNEL_INSTANCE_ID,
    status: 'active',
    assignee: AGENT_ASSIGNEE,
    lastMessageAt: mins(70),
  })
  await insertMsg(ins, {
    id: 'msg0elnweb1',
    conversationId: ELENA_WEB_CONV_ID,
    role: 'customer',
    kind: 'text',
    content: {
      text: 'Also from the web — the billing portal link in my email 404s. Is there a direct URL I can bookmark?',
    },
    channelExternalId: 'web-elena-01',
    createdAt: mins(75),
  })
  await insertMsg(ins, {
    id: 'msg0elnweb2',
    conversationId: ELENA_WEB_CONV_ID,
    role: 'agent',
    kind: 'text',
    content: {
      text: "Sorry about that — the /billing route was renamed last week. Settings → Billing works, or direct link: app.meridian.com/settings/billing. I'll flag the stale email template internally.",
    },
    createdAt: mins(70),
  })

  // ── 5. Derek — resolved; quick slack-integration help, closed ───────
  await insertConv(ins, {
    id: DEREK_CONV_ID,
    contactId: DEREK_CONTACT_ID,
    channelInstanceId: WEB_CHANNEL_INSTANCE_ID,
    status: 'resolved',
    assignee: AGENT_ASSIGNEE,
    lastMessageAt: mins(1440),
    resolvedAt: mins(1430),
    resolvedReason: 'answered',
  })
  await insertMsg(ins, {
    id: 'msg0derk001',
    conversationId: DEREK_CONV_ID,
    role: 'customer',
    kind: 'text',
    content: { text: "Just signed up — how do I connect Slack? I'm on the free plan." },
    channelExternalId: 'web-derek-01',
    createdAt: mins(1460),
  })
  await insertMsg(ins, {
    id: 'msg0derk002',
    conversationId: DEREK_CONV_ID,
    role: 'agent',
    kind: 'text',
    content: {
      text: 'Welcome Derek! Slack integration is a Pro-plan feature — the 14-day trial on Pro includes it. Settings → Integrations → Slack once you start the trial. Want the upgrade page?',
    },
    createdAt: mins(1458),
  })
  await insertMsg(ins, {
    id: 'msg0derk003',
    conversationId: DEREK_CONV_ID,
    role: 'customer',
    kind: 'text',
    content: { text: 'Ah got it — will upgrade today. Thanks!' },
    channelExternalId: 'web-derek-03',
    createdAt: mins(1440),
  })
  await insertMsg(ins, {
    id: 'msg0derk004',
    conversationId: DEREK_CONV_ID,
    role: 'agent',
    kind: 'text',
    content: { text: 'Glad to help. Ping us if anything else comes up.' },
    createdAt: mins(1438),
  })
  await insertActivity(ins, {
    conversationId: DEREK_CONV_ID,
    type: 'conversation.resolved',
    payload: { by: MERIDIAN_AGENT_ID, reason: 'answered' },
    ts: mins(1430),
  })

  // ── 6. Sophia — active; Teams plan question, unassigned reply pending ──
  await insertConv(ins, {
    id: SOPHIA_CONV_ID,
    contactId: SOPHIA_CONTACT_ID,
    channelInstanceId: WEB_CHANNEL_INSTANCE_ID,
    status: 'active',
    assignee: `user:${BOB_USER_ID}`,
    lastMessageAt: mins(95),
  })
  await insertMsg(ins, {
    id: 'msg0soph001',
    conversationId: SOPHIA_CONV_ID,
    role: 'customer',
    kind: 'text',
    content: {
      text: 'Hi — our Teams audit log only goes back 90 days. We need 12 months for a vendor review. Is that possible on our plan, or do we need to upgrade?',
    },
    channelExternalId: 'web-sophia-01',
    createdAt: mins(95),
  })
  await insertNote(ins, {
    id: 'not0soph001',
    conversationId: SOPHIA_CONV_ID,
    authorType: 'agent',
    authorId: MERIDIAN_AGENT_ID,
    body: '@bob — Sophia (Teams, 8 seats) is asking about extended audit log retention. Enterprise-only feature per BUSINESS.md. Reassigning so you can quote an upgrade.',
    mentions: [BOB_USER_ID],
    createdAt: mins(93),
  })
  await insertActivity(ins, {
    conversationId: SOPHIA_CONV_ID,
    type: 'conversation.reassigned',
    payload: {
      from: AGENT_ASSIGNEE,
      to: `user:${BOB_USER_ID}`,
      reason: 'enterprise upgrade quote',
      by: MERIDIAN_AGENT_ID,
    },
    ts: mins(92),
  })

  // Priya scenario: earlier snooze that expired, then resolved-then-reopened loop
  await insertActivity(ins, {
    conversationId: PRIYA_CONV_ID,
    type: 'conversation.snoozed',
    payload: { until: mins(20).toISOString(), reason: 'waiting on product for filter docs', by: ALICE_USER_ID },
    ts: mins(60),
  })
  await insertActivity(ins, {
    conversationId: PRIYA_CONV_ID,
    type: 'conversation.snooze_expired',
    payload: { originalUntil: mins(20).toISOString() },
    ts: mins(20),
  })
}
