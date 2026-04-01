/**
 * Seed: conversations module — realistic demo data for a booking service.
 *
 * Uses @faker-js/faker to generate volume that makes every UI page look populated:
 * - ~50 contacts (customers, leads, staff)
 * - 3 channel instances + 3 channel routings
 * - ~80 conversations across all lifecycle states, spread over 30 days
 * - ~3 outbox messages per conversation (agent responses for transcript fallback)
 * - ~12 consultations across all states
 * - ~5 dead letters showing the DLQ terminal store
 * - ~6 eval runs across all statuses (complete, running, pending, error)
 */

import { faker } from '@faker-js/faker';
import type { VobaseDb } from '@vobase/core';
import { eq } from 'drizzle-orm';

import {
  activityEvents,
  aiEvalRuns,
  aiScorers,
  channelInstances,
  channelRoutings,
  consultations,
  contacts,
  conversations,
  deadLetters,
  outbox,
} from './schema';

// Deterministic seed so `bun run db:seed` always produces the same data
faker.seed(42);

const green = (s: string) => `\x1b[32m${s}\x1b[0m`;

function hoursAgo(n: number): Date {
  return new Date(Date.now() - n * 60 * 60 * 1000);
}

function randomItem<T>(arr: T[]): T {
  return arr[faker.number.int({ min: 0, max: arr.length - 1 })];
}

// ─── Generators ──────────────────────────────────────────────────────

function generateContacts(count: number) {
  const items: Array<{
    id: string;
    phone: string;
    email: string;
    name: string;
    role: 'customer' | 'lead' | 'staff';
    metadata: Record<string, unknown>;
  }> = [];

  // Always include fixed staff (for consultations)
  items.push(
    {
      id: 'contact-staff-david',
      phone: '+6590001111',
      email: 'david@clinic.sg',
      name: 'David Lim',
      role: 'staff',
      metadata: { department: 'operations' },
    },
    {
      id: 'contact-staff-eve',
      phone: '+6590002222',
      email: 'eve@clinic.sg',
      name: 'Eve Chen',
      role: 'staff',
      metadata: { department: 'management' },
    },
    {
      id: 'contact-staff-frank',
      phone: '+6590003333',
      email: 'frank@clinic.sg',
      name: 'Frank Ng',
      role: 'staff',
      metadata: { department: 'clinical' },
    },
  );

  // Generate customers + leads
  const usedPhones = new Set(items.map((c) => c.phone));
  const usedEmails = new Set(items.map((c) => c.email));

  for (let i = 0; i < count; i++) {
    let phone: string;
    do {
      phone = `+65${faker.string.numeric(8)}`;
    } while (usedPhones.has(phone));
    usedPhones.add(phone);

    let email: string;
    do {
      email = faker.internet.email({ provider: 'example.com' }).toLowerCase();
    } while (usedEmails.has(email));
    usedEmails.add(email);

    const role = faker.helpers.weightedArrayElement([
      { value: 'customer' as const, weight: 7 },
      { value: 'lead' as const, weight: 3 },
    ]);

    items.push({
      id: `contact-${faker.string.alphanumeric(8)}`,
      phone,
      email,
      name: faker.person.fullName(),
      role,
      metadata: {
        source: randomItem(['whatsapp', 'web', 'referral', 'walk-in']),
        ...(role === 'lead' && {
          campaign: randomItem([
            'google-ads',
            'facebook',
            'instagram',
            'organic',
          ]),
        }),
      },
    });
  }

  return items;
}

const AGENT_MESSAGES = {
  greeting: [
    'Hi! I am your booking assistant. How can I help you today?',
    'Welcome! How may I assist you with your appointment?',
    'Hello! I can help you book, reschedule, or cancel appointments. What would you like to do?',
    'Good day! Ready to help you with your booking needs.',
  ],
  availability: [
    'I can see several slots available next week. Would you prefer morning or afternoon?',
    'Let me check availability for you. We have openings on Monday, Wednesday, and Friday.',
    'Here are the available slots:\n- Mon 10:00 AM\n- Wed 2:00 PM\n- Thu 11:00 AM\n- Fri 3:00 PM',
    'We have good availability this week. Any preferred day?',
  ],
  confirmation: [
    'Your appointment is confirmed! Here are the details:\n- Date: {date}\n- Time: {time}\n- Service: General Consultation',
    'All set! Your booking reference is {ref}. See you on {date} at {time}.',
    'Booking confirmed. You will receive a reminder 24 hours before your appointment.',
    'Great, I have booked that for you. Reference: {ref}.',
  ],
  reschedule: [
    'Let me check your existing booking so we can look at rescheduling options.',
    'I can see your current appointment. When would you like to reschedule to?',
    'No problem, I will reschedule that for you. What date and time work better?',
  ],
  fallback: [
    'We are experiencing a temporary issue. Please try again shortly.',
    'I apologize for the inconvenience. Let me connect you with a team member.',
    'Something went wrong on my end. A staff member will follow up with you.',
  ],
  followup: [
    'Just checking in — were you still looking to book an appointment?',
    'Hi again! I noticed we did not complete your booking. Would you like to continue?',
    'Friendly reminder: you had asked about availability. Shall I show you the latest openings?',
  ],
};

function randomMessage(category: keyof typeof AGENT_MESSAGES): string {
  const msg = randomItem(AGENT_MESSAGES[category]);
  return msg
    .replace('{date}', faker.date.soon({ days: 14 }).toLocaleDateString())
    .replace(
      '{time}',
      randomItem(['10:00 AM', '11:30 AM', '2:00 PM', '3:30 PM', '4:00 PM']),
    )
    .replace('{ref}', `BK-${faker.string.numeric(4)}`);
}

// ─── Seed function ───────────────────────────────────────────────────

export default async function seed(ctx: { db: VobaseDb }) {
  const { db } = ctx;

  // ─── Contacts ────────────────────────────────────────────────────
  const seedContacts = generateContacts(45);
  await db.insert(contacts).values(seedContacts).onConflictDoNothing();
  console.log(`${green('✓')} Seeded ${seedContacts.length} contacts`);

  // ─── Channel Instances ───────────────────────────────────────────
  const seedInstances = [
    {
      id: 'ci-wa-main',
      type: 'whatsapp',
      label: 'WhatsApp Business',
      source: 'self' as const,
      config: {},
      status: 'active',
    },
    {
      id: 'ci-web',
      type: 'web',
      label: 'Website Chat',
      source: 'env' as const,
      config: {},
      status: 'active',
    },
    {
      id: 'ci-wa-sandbox',
      type: 'whatsapp',
      label: 'WhatsApp Sandbox',
      source: 'sandbox' as const,
      config: {},
      status: 'disconnected',
    },
  ];

  await db.insert(channelInstances).values(seedInstances).onConflictDoNothing();

  // ─── Channel Routings ─────────────────────────────────────────────
  const seedChannelRoutings = [
    {
      id: 'ep-wa-booking',
      name: 'WhatsApp Booking',
      channelInstanceId: 'ci-wa-main',
      agentId: 'booking',
      assignmentPattern: 'direct' as const,
      config: {},
      enabled: true,
    },
    {
      id: 'ep-web-booking',
      name: 'Web Chat Booking',
      channelInstanceId: 'ci-web',
      agentId: 'booking',
      assignmentPattern: 'direct' as const,
      config: {},
      enabled: true,
    },
    {
      id: 'ep-wa-sandbox',
      name: 'Sandbox Testing',
      channelInstanceId: 'ci-wa-sandbox',
      agentId: 'booking',
      assignmentPattern: 'direct' as const,
      config: {},
      enabled: false,
    },
  ];

  await db
    .insert(channelRoutings)
    .values(seedChannelRoutings)
    .onConflictDoNothing();

  // ─── Conversations ───────────────────────────────────────────────
  // ~80 conversations spread over last 30 days, all lifecycle states
  const customerContacts = seedContacts.filter((c) => c.role !== 'staff');
  const staffContacts = seedContacts.filter((c) => c.role === 'staff');
  const activeChannelRoutings = seedChannelRoutings.filter((e) => e.enabled);

  const CONVERSATION_COUNT = 80;
  const seedConversations: Array<{
    id: string;
    channelRoutingId: string;
    contactId: string;
    agentId: string;
    channelInstanceId: string;
    status: string;
    conversationType: string;
    startedAt: Date;
    endedAt?: Date;
    metadata: Record<string, unknown>;
  }> = [];

  for (let i = 0; i < CONVERSATION_COUNT; i++) {
    const ep = randomItem(activeChannelRoutings);
    const contact = randomItem(customerContacts);
    const startHoursAgo = faker.number.int({ min: 1, max: 720 }); // up to 30 days

    const status = faker.helpers.weightedArrayElement([
      { value: 'completed', weight: 50 },
      { value: 'active', weight: 30 },
      { value: 'failed', weight: 20 },
    ]);

    const startedAt = hoursAgo(startHoursAgo);
    const endedAt =
      status === 'completed' || status === 'failed'
        ? hoursAgo(startHoursAgo - faker.number.int({ min: 0, max: 2 }))
        : undefined;

    const metadata: Record<string, unknown> = {};
    if (status === 'failed') {
      metadata.error = randomItem([
        'Agent exceeded max steps',
        'Memory thread creation failed',
        'Unhandled tool error: check_availability',
        'Context window exceeded',
      ]);
    }
    if (faker.datatype.boolean(0.1)) {
      metadata.memoryDegraded = true;
    }

    seedConversations.push({
      id: `sess-${faker.string.alphanumeric(10)}`,
      channelRoutingId: ep.id,
      contactId: contact.id,
      agentId: 'booking',
      channelInstanceId: ep.channelInstanceId,
      status,
      conversationType: 'message',
      startedAt,
      ...(endedAt && { endedAt }),
      metadata,
    });
  }

  await db
    .insert(conversations)
    .values(seedConversations)
    .onConflictDoNothing();

  // ─── Mode Conversations (for control plane testing) ─────────────────
  const modeConversations = [
    {
      id: 'sess-human-mode',
      channelRoutingId: 'ep-web-booking',
      contactId: customerContacts[0].id,
      agentId: 'booking',
      channelInstanceId: 'ci-web',
      status: 'active',
      conversationType: 'message',
      mode: 'human',
      assignee: null,
      assignedAt: null,
      startedAt: hoursAgo(2),
      hasPendingEscalation: true,
      waitingSince: hoursAgo(2),
      unreadCount: 3,
      metadata: {},
    },
    {
      id: 'sess-supervised-mode',
      channelRoutingId: 'ep-web-booking',
      contactId: customerContacts[1].id,
      agentId: 'booking',
      channelInstanceId: 'ci-web',
      status: 'active',
      conversationType: 'message',
      mode: 'supervised',
      assignee: null,
      assignedAt: null,
      startedAt: hoursAgo(1),
      hasPendingEscalation: true,
      waitingSince: hoursAgo(1),
      unreadCount: 2,
      metadata: {},
    },
    {
      id: 'sess-held-mode',
      channelRoutingId: 'ep-wa-booking',
      contactId: customerContacts[2].id,
      agentId: 'booking',
      channelInstanceId: 'ci-wa-main',
      status: 'active',
      conversationType: 'message',
      mode: 'held',
      assignee: null,
      assignedAt: null,
      priority: 'high',
      startedAt: hoursAgo(3),
      waitingSince: hoursAgo(3),
      unreadCount: 0,
      metadata: {},
    },
    // Additional escalated conversations with priorities for queue testing
    {
      id: 'sess-human-urgent',
      channelRoutingId: 'ep-wa-booking',
      contactId: customerContacts[7].id,
      agentId: 'booking',
      channelInstanceId: 'ci-wa-main',
      status: 'active',
      conversationType: 'message',
      mode: 'human',
      assignee: null,
      assignedAt: null,
      priority: 'urgent',
      startedAt: hoursAgo(0.5),
      waitingSince: hoursAgo(0.5),
      unreadCount: 5,
      metadata: {},
    },
    {
      id: 'sess-human-high',
      channelRoutingId: 'ep-web-booking',
      contactId: customerContacts[8].id,
      agentId: 'booking',
      channelInstanceId: 'ci-web',
      status: 'active',
      conversationType: 'message',
      mode: 'human',
      assignee: null,
      assignedAt: null,
      priority: 'high',
      startedAt: hoursAgo(1.5),
      waitingSince: hoursAgo(1.5),
      unreadCount: 1,
      metadata: {},
    },
    {
      id: 'sess-supervised-normal',
      channelRoutingId: 'ep-wa-booking',
      contactId: customerContacts[9].id,
      agentId: 'booking',
      channelInstanceId: 'ci-wa-main',
      status: 'active',
      conversationType: 'message',
      mode: 'supervised',
      assignee: null,
      assignedAt: null,
      priority: 'normal',
      startedAt: hoursAgo(4),
      waitingSince: hoursAgo(4),
      metadata: {},
    },
    {
      id: 'sess-human-low',
      channelRoutingId: 'ep-web-booking',
      contactId: customerContacts[10].id,
      agentId: 'booking',
      channelInstanceId: 'ci-web',
      status: 'active',
      conversationType: 'message',
      mode: 'human',
      assignee: null,
      assignedAt: null,
      priority: 'low',
      startedAt: hoursAgo(12),
      waitingSince: hoursAgo(12),
      metadata: {},
    },
    {
      id: 'sess-supervised-high',
      channelRoutingId: 'ep-wa-booking',
      contactId: customerContacts[11].id,
      agentId: 'booking',
      channelInstanceId: 'ci-wa-main',
      status: 'active',
      conversationType: 'message',
      mode: 'supervised',
      assignee: null,
      assignedAt: null,
      priority: 'high',
      startedAt: hoursAgo(0.25),
      waitingSince: hoursAgo(0.25),
      metadata: {},
    },
    {
      id: 'sess-for-handoff',
      channelRoutingId: 'ep-web-booking',
      contactId: customerContacts[3].id,
      agentId: 'booking',
      channelInstanceId: 'ci-web',
      status: 'active',
      conversationType: 'message',
      mode: 'ai',
      assignee: null,
      assignedAt: null,
      startedAt: hoursAgo(0.5),
      hasPendingEscalation: true,
      metadata: {},
    },
    {
      id: 'sess-for-completion',
      channelRoutingId: 'ep-web-booking',
      contactId: customerContacts[4].id,
      agentId: 'booking',
      channelInstanceId: 'ci-web',
      status: 'active',
      conversationType: 'message',
      mode: 'ai',
      assignee: null,
      assignedAt: null,
      startedAt: hoursAgo(1),
      metadata: {},
    },
    {
      id: 'sess-with-resolution',
      channelRoutingId: 'ep-wa-booking',
      contactId: customerContacts[5].id,
      agentId: 'booking',
      channelInstanceId: 'ci-wa-main',
      status: 'completed',
      conversationType: 'message',
      mode: 'ai',
      resolutionOutcome: 'resolved',
      startedAt: hoursAgo(24),
      endedAt: hoursAgo(23),
      metadata: {},
    },
    {
      id: 'sess-escalated-resolved',
      channelRoutingId: 'ep-wa-booking',
      contactId: customerContacts[6].id,
      agentId: 'booking',
      channelInstanceId: 'ci-wa-main',
      status: 'completed',
      conversationType: 'message',
      mode: 'ai',
      priority: 'high',
      resolutionOutcome: 'escalated_resolved',
      startedAt: hoursAgo(48),
      endedAt: hoursAgo(47),
      metadata: {},
    },
  ];

  await db
    .insert(conversations)
    .values(modeConversations)
    .onConflictDoNothing();

  // ─── Outbox ──────────────────────────────────────────────────────
  // 2-4 messages per conversation → gives transcript content
  const seedOutbox: Array<{
    id: string;
    conversationId: string;
    content: string;
    channelType: string;
    channelInstanceId: string;
    externalMessageId?: string;
    status: string;
    retryCount: number;
    createdAt: Date;
  }> = [];

  const allConversationsForOutbox = [
    ...seedConversations,
    ...modeConversations,
  ];
  for (const sess of allConversationsForOutbox) {
    const channelType =
      sess.channelInstanceId === 'ci-wa-main' ? 'whatsapp' : 'web';
    const msgCount = faker.number.int({ min: 2, max: 5 });

    // First message is always a greeting
    const categories: Array<keyof typeof AGENT_MESSAGES> = ['greeting'];
    for (let m = 1; m < msgCount; m++) {
      if (m === 1) {
        categories.push('availability');
      } else if (m === msgCount - 1 && sess.status === 'completed') {
        categories.push('confirmation');
      } else if (m === msgCount - 1 && sess.status === 'failed') {
        categories.push('fallback');
      } else {
        categories.push(randomItem(['availability', 'reschedule', 'followup']));
      }
    }

    for (let m = 0; m < categories.length; m++) {
      const msgHoursAgo =
        (sess.startedAt.getTime() - Date.now()) / (-1000 * 60 * 60) - m * 0.1;
      const createdAt = hoursAgo(Math.max(0, msgHoursAgo));

      let msgStatus: string;
      if (sess.status === 'completed') {
        msgStatus = randomItem(['delivered', 'read']);
      } else if (sess.status === 'failed' && m === categories.length - 1) {
        msgStatus = 'failed';
      } else if (sess.status === 'active' && m === categories.length - 1) {
        msgStatus = randomItem(['queued', 'sent']);
      } else {
        msgStatus = 'delivered';
      }

      const hasExternalId = msgStatus !== 'queued' && msgStatus !== 'failed';

      seedOutbox.push({
        id: `ob-${faker.string.alphanumeric(10)}`,
        conversationId: sess.id,
        content: randomMessage(categories[m]),
        channelType,
        channelInstanceId: sess.channelInstanceId,
        ...(hasExternalId && {
          externalMessageId: `${channelType === 'whatsapp' ? 'wamid' : 'web'}.${faker.string.alphanumeric(12)}`,
        }),
        status: msgStatus,
        retryCount:
          msgStatus === 'failed' ? faker.number.int({ min: 1, max: 5 }) : 0,
        createdAt,
      });
    }
  }

  // Insert in batches to avoid large single-statement inserts
  const BATCH_SIZE = 50;
  for (let i = 0; i < seedOutbox.length; i += BATCH_SIZE) {
    await db
      .insert(outbox)
      .values(seedOutbox.slice(i, i + BATCH_SIZE))
      .onConflictDoNothing();
  }

  // ─── Consultations ───────────────────────────────────────────────
  // Pick ~12 conversations that had human escalation
  const completedSessions = seedConversations.filter(
    (s) => s.status === 'completed',
  );
  const activeSessions = seedConversations.filter((s) => s.status === 'active');
  const failedSessions = seedConversations.filter((s) => s.status === 'failed');

  const CONSULTATION_REASONS = [
    'Customer requesting special pricing for a package deal.',
    'Customer asked about group booking policy.',
    'Complex scheduling conflict — needs manual resolution.',
    'Customer wants to book outside normal operating hours.',
    'Customer requesting refund for no-show appointment.',
    'VIP customer — needs priority scheduling.',
    'Insurance billing question beyond agent knowledge.',
    'Customer complaint about wait times.',
    'Multi-location booking across branches.',
    'Corporate wellness package inquiry — needs manager approval.',
    'Customer requesting home visit service.',
    'Accessibility requirements for appointment venue.',
  ];

  const seedConsultations: Array<{
    id: string;
    conversationId: string;
    staffContactId: string;
    channelType: string;
    channelInstanceId?: string;
    reason: string;
    summary?: string;
    status: string;
    timeoutMinutes: number;
    requestedAt: Date;
    repliedAt?: Date;
  }> = [];

  // Pending (from active sessions)
  for (let i = 0; i < Math.min(3, activeSessions.length); i++) {
    const sess = activeSessions[i];
    seedConsultations.push({
      id: `consult-${faker.string.alphanumeric(8)}`,
      conversationId: sess.id,
      staffContactId: randomItem(staffContacts).id,
      channelType: sess.channelInstanceId === 'ci-wa-main' ? 'whatsapp' : 'web',
      channelInstanceId: sess.channelInstanceId,
      reason: CONSULTATION_REASONS[i],
      status: 'pending',
      timeoutMinutes: 30,
      requestedAt: hoursAgo(faker.number.int({ min: 0, max: 1 })),
    });
  }

  // Replied (from completed sessions)
  for (let i = 0; i < Math.min(4, completedSessions.length); i++) {
    const sess = completedSessions[i];
    const reqHours = faker.number.int({ min: 24, max: 200 });
    seedConsultations.push({
      id: `consult-${faker.string.alphanumeric(8)}`,
      conversationId: sess.id,
      staffContactId: randomItem(staffContacts).id,
      channelType: sess.channelInstanceId === 'ci-wa-main' ? 'whatsapp' : 'web',
      channelInstanceId: sess.channelInstanceId,
      reason: CONSULTATION_REASONS[3 + i],
      summary: randomItem([
        'Approved with 10% discount. Manager confirmed.',
        'Rescheduled to next available slot. Customer satisfied.',
        'Referred to billing department for follow-up.',
        'Special accommodation arranged. Notes added to file.',
      ]),
      status: 'replied',
      timeoutMinutes: 30,
      requestedAt: hoursAgo(reqHours),
      repliedAt: hoursAgo(reqHours - faker.number.int({ min: 0, max: 1 })),
    });
  }

  // Timeout
  for (let i = 0; i < Math.min(2, completedSessions.length - 4); i++) {
    const sess = completedSessions[4 + i];
    if (!sess) break;
    seedConsultations.push({
      id: `consult-${faker.string.alphanumeric(8)}`,
      conversationId: sess.id,
      staffContactId: randomItem(staffContacts).id,
      channelType: sess.channelInstanceId === 'ci-wa-main' ? 'whatsapp' : 'web',
      channelInstanceId: sess.channelInstanceId,
      reason: CONSULTATION_REASONS[7 + i],
      status: 'timeout',
      timeoutMinutes: 30,
      requestedAt: hoursAgo(faker.number.int({ min: 48, max: 200 })),
    });
  }

  // Notification failed
  for (let i = 0; i < Math.min(2, failedSessions.length); i++) {
    const sess = failedSessions[i];
    seedConsultations.push({
      id: `consult-${faker.string.alphanumeric(8)}`,
      conversationId: sess.id,
      staffContactId: randomItem(staffContacts).id,
      channelType: 'whatsapp',
      channelInstanceId: 'ci-wa-main',
      reason: CONSULTATION_REASONS[9 + i],
      status: 'notification_failed',
      timeoutMinutes: 30,
      requestedAt: hoursAgo(faker.number.int({ min: 4, max: 72 })),
    });
  }

  if (seedConsultations.length > 0) {
    await db
      .insert(consultations)
      .values(seedConsultations)
      .onConflictDoNothing();
  }

  // ─── Dead Letters ────────────────────────────────────────────────
  const DL_ERRORS = [
    'WhatsApp Cloud API error 131026: recipient phone number not on WhatsApp',
    'WhatsApp Cloud API error 130429: rate limit exceeded, retry after 3600s',
    'WhatsApp Cloud API error 131047: 24-hour message window expired',
    'SMTP: mailbox unavailable — user unknown',
    'Connection timeout after 30000ms',
  ];

  const seedDeadLetters = DL_ERRORS.map((error, i) => {
    const sess = completedSessions[i] ?? seedConversations[i];
    return {
      id: `dl-${faker.string.alphanumeric(8)}`,
      originalOutboxId: `ob-expired-${faker.string.alphanumeric(6)}`,
      conversationId: sess.id,
      channelType: i < 3 ? 'whatsapp' : 'web',
      channelInstanceId: i < 3 ? 'ci-wa-main' : 'ci-web',
      recipientAddress: randomItem(customerContacts).phone,
      content: randomMessage(i < 3 ? 'confirmation' : 'followup'),
      error,
      retryCount: 5,
      status: 'dead' as const,
      failedAt: hoursAgo(faker.number.int({ min: 24, max: 500 })),
    };
  });

  await db.insert(deadLetters).values(seedDeadLetters).onConflictDoNothing();

  // ─── Activity Events (control plane) ──────────────────────────────
  const seedActivityEvents = [
    // Escalation events (attention queue)
    {
      type: 'escalation.created',
      agentId: 'booking',
      source: 'agent',
      contactId: customerContacts[0].id,
      conversationId: activeSessions[0]?.id ?? seedConversations[0].id,
      channelRoutingId: 'ep-wa-booking',
      channelType: 'whatsapp',
      data: {
        reason: 'Customer requesting special pricing',
        staffContactId: 'contact-staff-david',
      },
      resolutionStatus: 'pending',
      createdAt: hoursAgo(3),
    },
    {
      type: 'escalation.created',
      agentId: 'booking',
      source: 'agent',
      contactId: customerContacts[1].id,
      conversationId: activeSessions[1]?.id ?? seedConversations[1].id,
      channelRoutingId: 'ep-web-booking',
      channelType: 'web',
      data: { reason: 'Complex scheduling conflict' },
      resolutionStatus: 'pending',
      createdAt: hoursAgo(2),
    },
    // Guardrail block event (attention queue)
    {
      type: 'guardrail.block',
      agentId: 'booking',
      source: 'system',
      contactId: customerContacts[2].id,
      conversationId: activeSessions[2]?.id ?? seedConversations[2].id,
      channelRoutingId: 'ep-wa-booking',
      channelType: 'whatsapp',
      data: { reason: 'Blocked offensive content', matchedTerm: 'profanity' },
      resolutionStatus: 'pending',
      createdAt: hoursAgo(1),
    },
    // Already reviewed escalation
    {
      type: 'escalation.created',
      agentId: 'booking',
      source: 'agent',
      contactId: customerContacts[3].id,
      conversationId: completedSessions[0]?.id ?? seedConversations[3].id,
      channelRoutingId: 'ep-wa-booking',
      channelType: 'whatsapp',
      data: { reason: 'VIP customer needs priority' },
      resolutionStatus: 'reviewed',
      createdAt: hoursAgo(24),
    },
    // Session lifecycle events
    {
      type: 'conversation.created',
      agentId: 'booking',
      source: 'system',
      contactId: customerContacts[0].id,
      conversationId: activeSessions[0]?.id ?? seedConversations[0].id,
      channelRoutingId: 'ep-wa-booking',
      channelType: 'whatsapp',
      data: {},
      createdAt: hoursAgo(5),
    },
    {
      type: 'conversation.created',
      agentId: 'booking',
      source: 'system',
      contactId: customerContacts[1].id,
      conversationId: activeSessions[1]?.id ?? seedConversations[1].id,
      channelRoutingId: 'ep-web-booking',
      channelType: 'web',
      data: {},
      createdAt: hoursAgo(4.5),
    },
    {
      type: 'conversation.completed',
      agentId: 'booking',
      source: 'system',
      conversationId: completedSessions[0]?.id ?? seedConversations[3].id,
      data: { resolutionOutcome: 'resolved' },
      createdAt: hoursAgo(20),
    },
    {
      type: 'conversation.failed',
      agentId: 'booking',
      source: 'system',
      conversationId: failedSessions[0]?.id ?? seedConversations[4].id,
      data: { reason: 'Agent exceeded max steps' },
      createdAt: hoursAgo(18),
    },
    // Tool execution events
    {
      type: 'agent.tool_executed',
      agentId: 'booking',
      source: 'agent',
      contactId: customerContacts[0].id,
      conversationId: activeSessions[0]?.id ?? seedConversations[0].id,
      channelType: 'whatsapp',
      data: { toolName: 'book_slot', isError: false },
      createdAt: hoursAgo(4),
    },
    {
      type: 'agent.tool_executed',
      agentId: 'booking',
      source: 'agent',
      contactId: customerContacts[1].id,
      conversationId: activeSessions[1]?.id ?? seedConversations[1].id,
      channelType: 'web',
      data: { toolName: 'check_availability', isError: false },
      createdAt: hoursAgo(3.5),
    },
    {
      type: 'agent.tool_executed',
      agentId: 'booking',
      source: 'agent',
      contactId: customerContacts[2].id,
      conversationId: activeSessions[2]?.id ?? seedConversations[2].id,
      channelType: 'whatsapp',
      data: { toolName: 'send_reminder', isError: false },
      createdAt: hoursAgo(3),
    },
    // Handler mode change event
    {
      type: 'handler.changed',
      agentId: 'booking',
      source: 'agent',
      conversationId: 'sess-human-mode',
      data: {
        from: 'ai',
        to: 'human',
        reason: 'Customer requested human agent',
      },
      createdAt: hoursAgo(2),
    },
    // Message events
    {
      type: 'message.outbound_queued',
      source: 'agent',
      conversationId: activeSessions[0]?.id ?? seedConversations[0].id,
      channelType: 'whatsapp',
      data: { outboxId: 'ob-test-1' },
      createdAt: hoursAgo(4),
    },
    // Guardrail warn (non-attention, just activity)
    {
      type: 'guardrail.warn',
      agentId: 'booking',
      source: 'system',
      contactId: customerContacts[4].id,
      conversationId: activeSessions[3]?.id ?? seedConversations[4].id,
      channelType: 'web',
      data: { reason: 'Potential PII detected', matchedTerm: 'NRIC' },
      createdAt: hoursAgo(6),
    },
    // Supervised draft event
    {
      type: 'agent.draft_generated',
      agentId: 'booking',
      source: 'agent',
      conversationId: 'sess-supervised-mode',
      channelType: 'web',
      data: {
        handlerMode: 'supervised',
        draftContent: 'Here is your appointment confirmation for Monday 10am.',
      },
      resolutionStatus: 'pending',
      createdAt: hoursAgo(0.5),
    },
  ];

  const insertedEvents = await db
    .insert(activityEvents)
    .values(seedActivityEvents)
    .onConflictDoNothing()
    .returning({
      id: activityEvents.id,
      conversationId: activityEvents.conversationId,
    });

  // ─── Update last-signal pointers ────────────────────────────────
  // For mode conversations: point to their most relevant activity event
  for (const evt of insertedEvents) {
    if (evt.conversationId) {
      await db
        .update(conversations)
        .set({ lastSignalKind: 'activity', lastSignalId: evt.id })
        .where(eq(conversations.id, evt.conversationId));
    }
  }
  // For all conversations without an activity signal: point to their last outbox message
  const conversationsWithActivitySignal = new Set(
    insertedEvents.filter((e) => e.conversationId).map((e) => e.conversationId),
  );
  for (const sess of allConversationsForOutbox) {
    if (conversationsWithActivitySignal.has(sess.id)) continue;
    const lastMsg = seedOutbox
      .filter((o) => o.conversationId === sess.id)
      .sort((a, b) => b.createdAt.getTime() - a.createdAt.getTime())[0];
    if (lastMsg) {
      await db
        .update(conversations)
        .set({ lastSignalKind: 'message', lastSignalId: lastMsg.id })
        .where(eq(conversations.id, sess.id));
    }
  }

  console.log(
    `${green('✓')} Seeded ${modeConversations.length} mode conversations, ${seedActivityEvents.length} activity events`,
  );

  // ─── Eval runs ──────────────────────────────────────────────────
  // Realistic eval run history so the /ai/evals page renders populated.

  // Deterministic scores using faker (re-seed for eval block)
  faker.seed(99);

  const bookingQAPairs = [
    {
      input: 'Can I book an appointment for next Monday at 10am?',
      output:
        'I can check availability for Monday at 10am. Let me look that up for you.',
      context: [
        'You are a booking assistant for a service business.',
        'Available slots are managed via the check-availability tool.',
      ],
    },
    {
      input: 'I need to reschedule my appointment from Tuesday to Thursday.',
      output:
        "I'll help you reschedule. Let me check Thursday availability and move your booking.",
      context: [
        'You are a booking assistant.',
        'Use reschedule-booking tool to move appointments.',
      ],
    },
    {
      input: 'What services do you offer?',
      output:
        'We offer haircuts, coloring, styling, and treatments. Would you like to book any of these?',
      context: [
        'You are a booking assistant for a hair salon.',
        'Services: haircut ($30), coloring ($80), styling ($50), treatments ($60).',
      ],
    },
    {
      input: 'Cancel my appointment please.',
      output:
        "I'll cancel your upcoming appointment right away. You'll receive a confirmation shortly.",
      context: [
        'You are a booking assistant.',
        'Use cancel-booking tool. Always confirm cancellation with the customer.',
      ],
    },
    {
      input: 'Do you have any availability this weekend?',
      output:
        'Let me check our weekend slots for you. We typically have Saturday morning and afternoon openings.',
      context: [
        'You are a booking assistant.',
        'Weekend hours: Saturday 9am-5pm, Sunday closed.',
      ],
    },
    {
      input: 'How much does a haircut cost?',
      output:
        'A standard haircut is $30. We also have premium cuts at $45 which include a wash and style.',
      context: [
        'You are a booking assistant for a hair salon.',
        'Pricing: standard cut $30, premium cut $45, kids cut $20.',
      ],
    },
  ];

  function makeEvalItems(
    pairs: typeof bookingQAPairs,
    scoreRange: [number, number],
  ) {
    return pairs.map((p) => ({
      ...p,
      scores: {
        'answer-relevancy-scorer':
          Math.round(
            faker.number.float({ min: scoreRange[0], max: scoreRange[1] }) *
              100,
          ) / 100,
        'faithfulness-scorer':
          Math.round(
            faker.number.float({ min: scoreRange[0], max: scoreRange[1] }) *
              100,
          ) / 100,
      },
    }));
  }

  const seedEvalRuns = [
    {
      id: 'eval-run-001',
      agentId: 'booking',
      status: 'complete' as const,
      itemCount: 6,
      results: JSON.stringify(makeEvalItems(bookingQAPairs, [0.82, 0.97])),
      createdAt: hoursAgo(7 * 24),
      completedAt: hoursAgo(7 * 24),
    },
    {
      id: 'eval-run-002',
      agentId: 'booking',
      status: 'complete' as const,
      itemCount: 4,
      results: JSON.stringify(
        makeEvalItems(bookingQAPairs.slice(0, 4), [0.58, 0.78]),
      ),
      createdAt: hoursAgo(5 * 24),
      completedAt: hoursAgo(5 * 24),
    },
    {
      id: 'eval-run-003',
      agentId: 'booking',
      status: 'complete' as const,
      itemCount: 6,
      results: JSON.stringify(makeEvalItems(bookingQAPairs, [0.85, 0.99])),
      createdAt: hoursAgo(2 * 24),
      completedAt: hoursAgo(2 * 24),
    },
    {
      id: 'eval-run-004',
      agentId: 'booking',
      status: 'running' as const,
      itemCount: 3,
      results: null,
      createdAt: hoursAgo(1),
      completedAt: null,
    },
    {
      id: 'eval-run-005',
      agentId: 'booking',
      status: 'pending' as const,
      itemCount: 5,
      results: null,
      createdAt: hoursAgo(0.25),
      completedAt: null,
    },
    {
      id: 'eval-run-006',
      agentId: 'booking',
      status: 'error' as const,
      itemCount: 6,
      results: null,
      errorMessage: 'Scorer API rate limit exceeded — retry after 60s',
      createdAt: hoursAgo(3 * 24),
      completedAt: hoursAgo(3 * 24),
    },
  ];

  await db.insert(aiEvalRuns).values(seedEvalRuns).onConflictDoNothing();

  // Restore original faker seed
  faker.seed(42);

  console.log(`${green('✓')} Seeded ${seedEvalRuns.length} eval runs`);

  // ─── Custom scorers ─────────────────────────────────────────────
  const seedCustomScorers = [
    {
      id: 'scorer-policy',
      name: 'Policy Compliance',
      description:
        'Checks if the response follows booking and cancellation policies',
      criteria: [
        'Evaluate whether the AI response correctly follows the business booking and cancellation policies:',
        '- Cancellations must be made at least 24 hours in advance',
        '- Rescheduling is free for the first change, $25 fee after',
        '- No-shows are charged the full appointment fee',
        '- The agent should never promise exceptions to these policies',
        'Score 1.0 if the response fully complies, 0.0 if it contradicts a policy.',
      ].join('\n'),
      model: 'openai/gpt-5.4-mini',
      enabled: true,
    },
    {
      id: 'scorer-tone',
      name: 'Professional Tone',
      description:
        'Rates whether the response maintains a professional, helpful tone',
      criteria: [
        'Evaluate the tone and professionalism of the AI response:',
        '- Warm but professional (not overly casual or robotic)',
        '- Empathetic when the customer has a complaint or frustration',
        '- Clear and direct without unnecessary filler',
        '- Uses the customer name when available',
        'Score 1.0 for perfect tone, 0.5 for acceptable, 0.0 for inappropriate.',
      ].join('\n'),
      model: 'openai/gpt-5.4-mini',
      enabled: true,
    },
    {
      id: 'scorer-accuracy',
      name: 'Availability Accuracy',
      description:
        'Checks if the agent accurately reports appointment availability',
      criteria: [
        'Evaluate whether the AI agent accurately handled appointment availability:',
        '- Did it check availability before confirming a booking?',
        '- Did it offer alternative times when the requested slot was unavailable?',
        '- Did it avoid confirming appointments without tool verification?',
        'Score 1.0 if availability handling was correct, 0.0 if it made up availability.',
      ].join('\n'),
      model: 'openai/gpt-5.4-mini',
      enabled: true,
    },
  ];

  await db.insert(aiScorers).values(seedCustomScorers).onConflictDoNothing();

  console.log(
    `${green('✓')} Seeded ${seedCustomScorers.length} custom scorers`,
  );

  // ─── Summary ─────────────────────────────────────────────────────
  console.log(
    `${green('✓')} Seeded ${seedInstances.length} channel instances, ${seedChannelRoutings.length} channel routings, ${seedConversations.length} conversations`,
  );
  console.log(
    `${green('✓')} Seeded ${seedOutbox.length} outbox, ${seedConsultations.length} consultations, ${seedDeadLetters.length} dead letters`,
  );
}
