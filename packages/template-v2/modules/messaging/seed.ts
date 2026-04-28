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

import { MERIDIAN_AGENT_ID, SENTINEL_AGENT_ID } from '@modules/agents/seed'
import {
  ALICE_USER_ID,
  BOB_USER_ID,
  CAROL_USER_ID,
  CUSTOMER_CHANNEL_INSTANCE_ID,
  DEREK_CONTACT_ID,
  ELENA_CONTACT_ID,
  LIAM_CONTACT_ID,
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
export const LIAM_CONV_ID = 'cnv00liam0'

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
    parentNoteId?: string
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
      parentNoteId: row.parentNoteId ?? null,
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
  // Cross-lane mention: staff pings the OPERATOR agent (Sentinel) inside a
  // CONCIERGE-assigned customer thread. Exercises the supervisor fan-out
  // peer-wake path — Sentinel boots on its own builder lane while Meridian
  // (the assignee) gets a self-wake on the same note.
  await insertNote(ins, {
    id: 'not0priya01',
    conversationId: PRIYA_CONV_ID,
    authorType: 'staff',
    authorId: ALICE_USER_ID,
    body: '@Sentinel — Priya is the third Pro-plan customer this week asking about Slack routing. Worth flagging in tomorrow’s daily-brief as a recurring topic.',
    mentions: [`agent:${SENTINEL_AGENT_ID}`],
    createdAt: mins(7),
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

  // ── 7. Liam — consult-human loop ──────────────────────────────────
  // Customer asks a technical question Meridian can't answer alone. Agent
  // mentions @bob in an internal note → notification is delivered to Bob's
  // staff WhatsApp number → Bob replies via WA → that reply is recorded as
  // an internal note authored by 'staff' with @meridian in mentions →
  // supervisor wake fires → Meridian uses Bob's guidance to answer Liam.
  // Meanwhile Meridian keeps the customer engaged with a holding reply +
  // an information-gathering question so the wait is productive.
  await insertConv(ins, {
    id: LIAM_CONV_ID,
    contactId: LIAM_CONTACT_ID,
    channelInstanceId: WEB_CHANNEL_INSTANCE_ID,
    status: 'active',
    assignee: AGENT_ASSIGNEE,
    lastMessageAt: mins(25),
  })

  // T-65: customer's opening question
  await insertMsg(ins, {
    id: 'msg0liam01',
    conversationId: LIAM_CONV_ID,
    role: 'customer',
    kind: 'text',
    content: {
      text: "Hey — we're seeing 503s on outbound webhooks to one of our partner endpoints. What's your retry policy, and is there a way to set a per-endpoint override?",
    },
    channelExternalId: 'web-liam-01',
    createdAt: mins(65),
  })

  // T-64: Meridian's holding reply (acknowledge + ask for more info)
  await insertMsg(ins, {
    id: 'msg0liam02',
    conversationId: LIAM_CONV_ID,
    role: 'agent',
    kind: 'text',
    content: {
      text: 'Hey Liam — looking into it. Quick q to keep things moving: which webhook IDs are failing, and are you seeing the 503 only on one partner or multiple?',
    },
    status: 'delivered',
    createdAt: mins(64),
  })

  // T-63: Meridian @-mentions Bob via internal note (consult-human start)
  await insertNote(ins, {
    id: 'not0liam01',
    conversationId: LIAM_CONV_ID,
    authorType: 'agent',
    authorId: MERIDIAN_AGENT_ID,
    body: "@bob — Liam (FinSight, Pro) is hitting 503s on outbound webhooks. Standard exponential backoff applies, but he's asking if there's a per-endpoint override. Need your read on (a) retry policy details to share, (b) whether per-endpoint overrides are exposed today, (c) whether to honor `Retry-After`. I'll keep him engaged while we wait.",
    mentions: [BOB_USER_ID],
    createdAt: mins(63),
  })

  // T-63: notification dispatched to Bob's WhatsApp (system event so the
  // activity timeline shows the staff received the ping out-of-band)
  await insertActivity(ins, {
    conversationId: LIAM_CONV_ID,
    type: 'mention.notified',
    payload: {
      noteId: 'not0liam01',
      userId: BOB_USER_ID,
      channel: 'whatsapp',
      channelInstanceId: 'chi0staff0',
      externalIdentifier: '+6591110002',
      // What Bob actually saw on his phone — quoted preview of the agent's note.
      preview:
        '🤖 Meridian mentioned you in a conversation with Liam Reyes (FinSight): "503s on outbound webhooks, asking about per-endpoint overrides…"',
    },
    ts: mins(63),
  })

  // T-50: customer responds with the requested debug info
  await insertMsg(ins, {
    id: 'msg0liam03',
    conversationId: LIAM_CONV_ID,
    role: 'customer',
    kind: 'text',
    content: {
      text: 'Just one partner so far. Failing webhooks: wbk_p3a91f and wbk_p3a92e — both pointed at their /events endpoint. Their server returns 503 with a Retry-After header sometimes (~60s), other times no header.',
    },
    channelExternalId: 'web-liam-03',
    createdAt: mins(50),
  })

  // T-49: Meridian keeps the customer engaged WHILE WAITING for Bob
  await insertMsg(ins, {
    id: 'msg0liam04',
    conversationId: LIAM_CONV_ID,
    role: 'agent',
    kind: 'text',
    content: {
      text: "Got the IDs and the Retry-After detail — really helpful. I'm still consulting with our integrations lead on the override question; should have an answer shortly. While we wait: when the 503 fires without a Retry-After, are you currently retrying inline or queuing for a worker?",
    },
    status: 'delivered',
    createdAt: mins(49),
  })

  // T-30: Bob replies via WhatsApp staff number — recorded as a staff
  // internal note. The inbound webhook attaches @meridian to mentions so
  // the supervisor wake fires off it.
  await insertNote(ins, {
    id: 'not0liam02',
    conversationId: LIAM_CONV_ID,
    authorType: 'staff',
    authorId: BOB_USER_ID,
    body: '@meridian — exponential backoff up to 5 attempts, base 30s, cap 5 min. We do not expose per-endpoint overrides yet (file as a feature request to @alice). For 503s WITH `Retry-After`, honor the header verbatim and skip our default schedule. WITHOUT the header, fall back to our default. If 5 attempts fail, dead-letter to the partner-webhook DLQ in Settings → Integrations → Logs.',
    mentions: [MERIDIAN_AGENT_ID],
    parentNoteId: 'not0liam01',
    createdAt: mins(30),
  })

  // T-30: inbound channel event recording where the staff reply came from.
  await insertActivity(ins, {
    conversationId: LIAM_CONV_ID,
    type: 'staff_reply.received',
    payload: {
      noteId: 'not0liam02',
      authorUserId: BOB_USER_ID,
      channel: 'whatsapp',
      channelInstanceId: 'chi0staff0',
      externalIdentifier: '+6591110002',
      whatsappMessageId: 'wamid.HBgLNjU5MTExMDAwMjAVAgARGBI4QkE0RkVCNjQ3REM4RDM4',
      // Echoes the format of the WA inbound payload after our adapter strips PII.
      replyMode: 'reply_to_notification',
    },
    ts: mins(30),
  })

  // T-30: supervisor wake fires off Bob's note (this is what kicks Meridian
  // back awake on the conversation; staff_signals.detectStaffSignals picks
  // this up as a `supervisor` signal).
  await insertActivity(ins, {
    conversationId: LIAM_CONV_ID,
    type: 'agent_wake.scheduled',
    payload: {
      trigger: 'supervisor',
      noteId: 'not0liam02',
      authorUserId: BOB_USER_ID,
      reason: 'staff replied to outstanding consultation',
    },
    ts: mins(30),
  })

  // T-29: Meridian uses Bob's guidance to give Liam a definitive answer
  await insertMsg(ins, {
    id: 'msg0liam05',
    conversationId: LIAM_CONV_ID,
    role: 'agent',
    kind: 'card',
    content: {
      card: {
        type: 'card',
        title: 'Webhook retry policy',
        children: [
          { type: 'text', style: 'body', content: 'Confirmed with our integrations lead:' },
          {
            type: 'fields',
            items: [
              { label: 'Schedule', value: 'Exponential backoff, 30s base, max 5 attempts, 5-min cap' },
              { label: 'With Retry-After', value: 'Header honored verbatim; default schedule skipped' },
              { label: 'Without Retry-After', value: 'Default schedule applies' },
              { label: 'After 5 fails', value: 'Dead-letter → Settings → Integrations → Logs' },
              { label: 'Per-endpoint overrides', value: 'Not exposed today (filed as a feature request)' },
            ],
          },
          {
            type: 'actions',
            buttons: [
              { id: 'liam-ack', label: 'Got it', value: 'ack' },
              { id: 'liam-dlq', label: 'Show me the DLQ', value: 'dlq' },
            ],
          },
        ],
      },
    },
    status: 'delivered',
    createdAt: mins(29),
  })

  // T-25: customer ack
  await insertMsg(ins, {
    id: 'msg0liam06',
    conversationId: LIAM_CONV_ID,
    role: 'customer',
    kind: 'card_reply',
    content: { buttonId: 'liam-ack', buttonValue: 'ack', buttonLabel: 'Got it' },
    parentMessageId: 'msg0liam05',
    channelExternalId: 'web-liam-06',
    createdAt: mins(25),
  })

  // T-25: customer follow-up — "Retry-After tip is gold"
  await insertMsg(ins, {
    id: 'msg0liam07',
    conversationId: LIAM_CONV_ID,
    role: 'customer',
    kind: 'text',
    content: {
      text: "Perfect — exactly what I needed. The Retry-After detail is gold; one of our partners does set it. I'll wire it up and ping back if anything else looks weird. Thanks for the fast turnaround!",
    },
    channelExternalId: 'web-liam-07',
    createdAt: mins(25),
  })

  // Meridian's internal post-resolution note: capture the per-endpoint
  // override as a feature request so Alice sees it on her queue.
  await insertNote(ins, {
    id: 'not0liam03',
    conversationId: LIAM_CONV_ID,
    authorType: 'agent',
    authorId: MERIDIAN_AGENT_ID,
    body: '@alice — per Bob, FYI: customers are starting to ask for per-endpoint webhook retry overrides. Liam (FinSight, Pro) is the second this month. Worth a /drive/BUSINESS.md mention or a roadmap line if/when planned.',
    mentions: [ALICE_USER_ID],
    createdAt: mins(24),
  })
}
