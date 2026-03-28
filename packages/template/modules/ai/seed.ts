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
 */

import { faker } from '@faker-js/faker';
import type { VobaseDb } from '@vobase/core';

import {
  activityEvents,
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
      { value: 'active', weight: 20 },
      { value: 'failed', weight: 15 },
      { value: 'paused', weight: 15 },
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

  // ─── Handler Mode Conversations (for control plane testing) ─────────
  const handlerModeConversations = [
    {
      id: 'sess-human-mode',
      channelRoutingId: 'ep-web-booking',
      contactId: customerContacts[0].id,
      agentId: 'booking',
      channelInstanceId: 'ci-web',
      status: 'active',
      conversationType: 'message',
      handler: 'human',
      assignedUserId: null,
      startedAt: hoursAgo(2),
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
      handler: 'supervised',
      assignedUserId: null,
      startedAt: hoursAgo(1),
      metadata: {},
    },
    {
      id: 'sess-paused-mode',
      channelRoutingId: 'ep-wa-booking',
      contactId: customerContacts[2].id,
      agentId: 'booking',
      channelInstanceId: 'ci-wa-main',
      status: 'active',
      conversationType: 'message',
      handler: 'paused',
      assignedUserId: null,
      startedAt: hoursAgo(3),
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
      handler: 'ai',
      assignedUserId: null,
      startedAt: hoursAgo(0.5),
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
      handler: 'ai',
      assignedUserId: null,
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
      handler: 'ai',
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
      handler: 'ai',
      resolutionOutcome: 'escalated_resolved',
      startedAt: hoursAgo(48),
      endedAt: hoursAgo(47),
      metadata: {},
    },
  ];

  await db
    .insert(conversations)
    .values(handlerModeConversations)
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

  for (const sess of seedConversations) {
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

  // Insert in batches to avoid hitting PGlite limits
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

  await db
    .insert(activityEvents)
    .values(seedActivityEvents)
    .onConflictDoNothing();

  console.log(
    `${green('✓')} Seeded ${handlerModeConversations.length} handler-mode conversations, ${seedActivityEvents.length} activity events`,
  );

  // ─── Summary ─────────────────────────────────────────────────────
  console.log(
    `${green('✓')} Seeded ${seedInstances.length} channel instances, ${seedChannelRoutings.length} channel routings, ${seedConversations.length} conversations`,
  );
  console.log(
    `${green('✓')} Seeded ${seedOutbox.length} outbox, ${seedConsultations.length} consultations, ${seedDeadLetters.length} dead letters`,
  );
}
