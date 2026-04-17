import { beforeEach, describe, expect, it } from 'bun:test';
import type {
  ChannelAdapter,
  ChannelsService,
  MessageReceivedEvent,
  RealtimeService,
  Scheduler,
  StorageService,
  VobaseDb,
} from '@vobase/core';
import { eq } from 'drizzle-orm';

import { createTestDb } from '../../../lib/test-helpers';
import {
  automationExecutions,
  automationRecipients,
  automationRules,
  broadcastRecipients,
  broadcasts,
  channelInstances,
  channelRoutings,
  channelSessions,
  contacts,
  conversations,
  messages,
} from '../schema';
import { setModuleDeps } from './deps';
import { handleInboundAction, handleInboundMessage } from './inbound';

// ─── Mock infrastructure ──────────────────────────────────────────

const schedulerJobs: Array<{
  name: string;
  data: unknown;
  opts?: unknown;
}> = [];

const mockScheduler = {
  async add(name: string, data: unknown, opts?: unknown) {
    schedulerJobs.push({ name, data, opts });
    return { id: 'job-1' };
  },
  async send() {
    return null;
  },
  async schedule() {},
  async unschedule() {},
  async stop() {},
} as unknown as Scheduler;

const mockRealtime: RealtimeService = {
  notify: async () => {},
} as never;

const mockWaAdapter: ChannelAdapter = {
  name: 'whatsapp',
  inboundMode: 'push',
  capabilities: {
    templates: true,
    media: true,
    reactions: true,
    readReceipts: true,
    typingIndicators: true,
    streaming: false,
    messagingWindow: true,
  },
  contactIdentifierField: 'phone',
  debounceWindowMs: 3000,
  deliveryModel: 'queued',
  async send(_message) {
    return { success: true, messageId: 'wa-msg-1' };
  },
};

const mockWebAdapter: ChannelAdapter = {
  name: 'web',
  inboundMode: 'push',
  capabilities: {
    templates: false,
    media: false,
    reactions: false,
    readReceipts: false,
    typingIndicators: false,
    streaming: true,
    messagingWindow: false,
  },
  contactIdentifierField: 'identifier',
  deliveryModel: 'realtime',
  async send(_message) {
    return { success: true, messageId: 'web-msg-1' };
  },
};

const adapterMap = new Map<string, ChannelAdapter>([
  ['whatsapp', mockWaAdapter],
  ['web', mockWebAdapter],
]);

const mockChannels: ChannelsService = {
  email: { send: async () => ({ success: true, messageId: 'e-1' }) },
  whatsapp: { send: async () => ({ success: true, messageId: 'w-1' }) },
  on() {},
  get(type: string) {
    const a = adapterMap.get(type);
    if (!a) return undefined;
    return { send: a.send.bind(a) };
  },
  getAdapter(type: string) {
    return adapterMap.get(type);
  },
  registerAdapter() {},
  unregisterAdapter() {},
  onProvision() {},
  async provision() {
    throw new Error('not implemented');
  },
} as never;

let uploadedFiles: Array<{ key: string; data: Buffer; opts: unknown }> = [];

const mockStorage: StorageService = {
  bucket(name: string) {
    return {
      async upload(key: string, data: Buffer, opts?: unknown) {
        uploadedFiles.push({ key, data, opts });
      },
      presign(key: string) {
        return `https://storage.test/${name}/${key}`;
      },
      async download() {
        return Buffer.from('');
      },
      async delete() {},
      async exists() {
        return false;
      },
      async list() {
        return [];
      },
    };
  },
} as never;

// ─── Helpers ──────────────────────────────────────────────────────

function makeEvent(
  overrides: Partial<MessageReceivedEvent> = {},
): MessageReceivedEvent {
  return {
    type: 'message_received',
    channel: 'whatsapp',
    from: '+6591234567',
    profileName: 'Test Customer',
    messageId: 'msg-ext-1',
    content: 'Hello',
    messageType: 'text',
    timestamp: Date.now(),
    channelInstanceId: 'ci-wa',
    ...overrides,
  };
}

// ─── Test suite ───────────────────────────────────────────────────

let db: VobaseDb;

beforeEach(async () => {
  const result = await createTestDb({ withAutomation: true });
  db = result.db;
  schedulerJobs.length = 0;
  uploadedFiles = [];

  setModuleDeps({
    db,
    scheduler: mockScheduler,
    channels: mockChannels,
    realtime: mockRealtime,
    storage: mockStorage,
  });

  // Seed base data
  await db.insert(contacts).values({
    id: 'contact-1',
    phone: '+6591234567',
    name: 'Test Customer',
    role: 'customer',
  });

  await db.insert(channelInstances).values([
    { id: 'ci-wa', type: 'whatsapp', label: 'WhatsApp', source: 'env' },
    { id: 'ci-web', type: 'web', label: 'Web Chat', source: 'env' },
  ]);

  await db.insert(channelRoutings).values([
    {
      id: 'cr-wa',
      name: 'WA Routing',
      channelInstanceId: 'ci-wa',
      agentId: 'agent-1',
    },
    {
      id: 'cr-web',
      name: 'Web Routing',
      channelInstanceId: 'ci-web',
      agentId: 'agent-1',
    },
  ]);
});

// ─── 1. New conversation creation ─────────────────────────────────

describe('handleInboundMessage — new conversation', () => {
  it('creates contact and conversation for unknown sender', async () => {
    const event = makeEvent({
      from: '+6599999999',
      profileName: 'New Person',
    });

    await handleInboundMessage(
      {
        db,
        scheduler: mockScheduler,
        channels: mockChannels,
        realtime: mockRealtime,
        storage: mockStorage,
      },
      event,
    );

    // Contact was created
    const [contact] = await db
      .select()
      .from(contacts)
      .where(eq(contacts.phone, '+6599999999'));
    expect(contact).toBeDefined();
    expect(contact.name).toBe('New Person');
    expect(contact.role).toBe('customer');

    // Conversation was created
    const allConvs = await db.select().from(conversations);
    expect(allConvs).toHaveLength(1);
    expect(allConvs[0].contactId).toBe(contact.id);
    expect(allConvs[0].channelInstanceId).toBe('ci-wa');
    expect(allConvs[0].status).toBe('active');
  });

  it('stores inbound message in newly created conversation', async () => {
    const event = makeEvent({
      from: '+6599999999',
      content: 'First message',
    });

    await handleInboundMessage(
      {
        db,
        scheduler: mockScheduler,
        channels: mockChannels,
        realtime: mockRealtime,
        storage: mockStorage,
      },
      event,
    );

    const allMessages = await db.select().from(messages);
    // createConversation also inserts activity messages, so filter for incoming
    const inbound = allMessages.filter((m) => m.messageType === 'incoming');
    expect(inbound).toHaveLength(1);
    expect(inbound[0].content).toBe('First message');
    expect(inbound[0].contentType).toBe('text');
    expect(inbound[0].senderType).toBe('contact');
  });

  it('skips silently when no enabled channel routing exists', async () => {
    // Disable the WA routing
    await db
      .update(channelRoutings)
      .set({ enabled: false })
      .where(eq(channelRoutings.id, 'cr-wa'));

    const event = makeEvent({ from: '+6599999999' });

    await handleInboundMessage(
      {
        db,
        scheduler: mockScheduler,
        channels: mockChannels,
        realtime: mockRealtime,
        storage: mockStorage,
      },
      event,
    );

    const allConvs = await db.select().from(conversations);
    expect(allConvs).toHaveLength(0);
  });
});

// ─── 2. Existing conversation routing ─────────────────────────────

describe('handleInboundMessage — existing conversation', () => {
  beforeEach(async () => {
    await db.insert(conversations).values({
      id: 'conv-existing',
      channelRoutingId: 'cr-wa',
      contactId: 'contact-1',
      agentId: 'agent-1',
      channelInstanceId: 'ci-wa',
      assignee: 'agent:agent-1',
      status: 'active',
    });
  });

  it('routes to existing active conversation instead of creating new', async () => {
    const event = makeEvent({ content: 'Follow-up message' });

    await handleInboundMessage(
      {
        db,
        scheduler: mockScheduler,
        channels: mockChannels,
        realtime: mockRealtime,
        storage: mockStorage,
      },
      event,
    );

    // No new conversation created
    const allConvs = await db.select().from(conversations);
    expect(allConvs).toHaveLength(1);
    expect(allConvs[0].id).toBe('conv-existing');

    // Message stored against existing conversation
    const allMessages = await db.select().from(messages);
    expect(allMessages.length).toBeGreaterThanOrEqual(1);
    const inbound = allMessages.find((m) => m.messageType === 'incoming');
    expect(inbound).toBeDefined();
    expect(inbound?.conversationId).toBe('conv-existing');
    expect(inbound?.content).toBe('Follow-up message');
  });
});

// ─── 4. Held mode — canned response ──────────────────────────────

describe('handleInboundMessage — held mode', () => {
  beforeEach(async () => {
    await db.insert(conversations).values({
      id: 'conv-held',
      channelRoutingId: 'cr-wa',
      contactId: 'contact-1',
      agentId: 'agent-1',
      channelInstanceId: 'ci-wa',
      assignee: 'agent:agent-1',
      status: 'active',
      onHold: true,
    });
  });

  it('accepts message silently (no auto-reply) for on-hold conversation', async () => {
    const event = makeEvent({ content: 'Hello, anyone there?' });

    await handleInboundMessage(
      {
        db,
        scheduler: mockScheduler,
        channels: mockChannels,
        realtime: mockRealtime,
        storage: mockStorage,
      },
      event,
    );

    // Inbound message is stored
    const allMessages = await db
      .select()
      .from(messages)
      .where(eq(messages.conversationId, 'conv-held'));

    const inbound = allMessages.find((m) => m.messageType === 'incoming');
    expect(inbound).toBeDefined();

    // No outgoing canned response — on-hold accepts silently in V1
    const outgoing = allMessages.find((m) => m.messageType === 'outgoing');
    expect(outgoing).toBeUndefined();

    // No delivery job, no agent-wake job
    expect(schedulerJobs).toHaveLength(0);
  });
});

// ─── 5. AI/supervised mode — agent-wake job ────────────────────

describe('handleInboundMessage — ai mode', () => {
  beforeEach(async () => {
    await db.insert(conversations).values({
      id: 'conv-ai',
      channelRoutingId: 'cr-wa',
      contactId: 'contact-1',
      agentId: 'agent-1',
      channelInstanceId: 'ci-wa',
      assignee: 'agent:agent-1',
      status: 'active',
    });
  });

  it('schedules agent-wake job with debounce for WhatsApp', async () => {
    const event = makeEvent({ content: 'Question for the AI' });

    await handleInboundMessage(
      {
        db,
        scheduler: mockScheduler,
        channels: mockChannels,
        realtime: mockRealtime,
        storage: mockStorage,
      },
      event,
    );

    const replyJob = schedulerJobs.find((j) => j.name === 'agents:agent-wake');
    expect(replyJob).toBeDefined();
    expect((replyJob?.data as { conversationId: string }).conversationId).toBe(
      'conv-ai',
    );
    // cancelWake + singletonKey dedup, 1s delay for advisory lock release
    expect(replyJob?.opts).toBeDefined();
    expect((replyJob?.opts as { singletonKey: string }).singletonKey).toContain(
      'agents:agent-wake:',
    );
    expect((replyJob?.opts as { startAfter: number }).startAfter).toBe(1);
  });
});

describe('handleInboundMessage — supervised mode', () => {
  beforeEach(async () => {
    await db.insert(conversations).values({
      id: 'conv-sup',
      channelRoutingId: 'cr-wa',
      contactId: 'contact-1',
      agentId: 'agent-1',
      channelInstanceId: 'ci-wa',
      assignee: 'agent:agent-1',
      status: 'active',
    });
  });

  it('schedules agent-wake job for supervised mode', async () => {
    const event = makeEvent({ content: 'Supervised question' });

    await handleInboundMessage(
      {
        db,
        scheduler: mockScheduler,
        channels: mockChannels,
        realtime: mockRealtime,
        storage: mockStorage,
      },
      event,
    );

    const replyJob = schedulerJobs.find((j) => j.name === 'agents:agent-wake');
    expect(replyJob).toBeDefined();
    expect((replyJob?.data as { conversationId: string }).conversationId).toBe(
      'conv-sup',
    );
  });
});

// ─── 6. Human mode — no agent trigger ─────────────────────────────

describe('handleInboundMessage — human mode', () => {
  beforeEach(async () => {
    await db.insert(conversations).values({
      id: 'conv-human',
      channelRoutingId: 'cr-wa',
      contactId: 'contact-1',
      agentId: 'agent-1',
      channelInstanceId: 'ci-wa',
      assignee: 'user-1',
      status: 'active',
    });
  });

  it('records inbound message but does not schedule agent-wake job', async () => {
    const event = makeEvent({ content: 'Talking to a human' });

    await handleInboundMessage(
      {
        db,
        scheduler: mockScheduler,
        channels: mockChannels,
        realtime: mockRealtime,
        storage: mockStorage,
      },
      event,
    );

    // Message stored
    const allMessages = await db
      .select()
      .from(messages)
      .where(eq(messages.conversationId, 'conv-human'));
    const inbound = allMessages.find((m) => m.messageType === 'incoming');
    expect(inbound).toBeDefined();
    expect(inbound?.content).toBe('Talking to a human');

    // No agent-wake job
    const replyJob = schedulerJobs.find((j) => j.name === 'agents:agent-wake');
    expect(replyJob).toBeUndefined();

    // No delivery job
    const deliveryJob = schedulerJobs.find(
      (j) => j.name === 'messaging:deliver-message',
    );
    expect(deliveryJob).toBeUndefined();
  });
});

// ─── 7. Media upload ──────────────────────────────────────────────

describe('handleInboundMessage — media upload', () => {
  beforeEach(async () => {
    await db.insert(conversations).values({
      id: 'conv-media',
      channelRoutingId: 'cr-wa',
      contactId: 'contact-1',
      agentId: 'agent-1',
      channelInstanceId: 'ci-wa',
      assignee: 'agent:agent-1',
      status: 'active',
    });
  });

  it('uploads media to storage and sets correct contentType', async () => {
    const imageBuffer = Buffer.from('fake-image-data');
    const event = makeEvent({
      content: '',
      messageId: 'media-msg-1',
      media: [
        {
          type: 'image',
          data: imageBuffer,
          mimeType: 'image/jpeg',
          filename: 'photo.jpg',
        },
      ],
    });

    await handleInboundMessage(
      {
        db,
        scheduler: mockScheduler,
        channels: mockChannels,
        realtime: mockRealtime,
        storage: mockStorage,
      },
      event,
    );

    // File was uploaded to storage
    expect(uploadedFiles).toHaveLength(1);
    expect(uploadedFiles[0].key).toContain('conv-media');
    expect(uploadedFiles[0].key).toContain('photo.jpg');

    // Message stored with image contentType
    const allMessages = await db
      .select()
      .from(messages)
      .where(eq(messages.conversationId, 'conv-media'));
    const inbound = allMessages.find((m) => m.messageType === 'incoming');
    expect(inbound).toBeDefined();
    expect(inbound?.contentType).toBe('image');
    expect(inbound?.content).toBe('[image]');
    expect((inbound?.contentData as { media: unknown[] }).media).toHaveLength(
      1,
    );
  });

  it('falls back to text contentType when no media provided', async () => {
    const event = makeEvent({ content: 'Just text, no media' });

    await handleInboundMessage(
      {
        db,
        scheduler: mockScheduler,
        channels: mockChannels,
        realtime: mockRealtime,
        storage: mockStorage,
      },
      event,
    );

    const allMessages = await db
      .select()
      .from(messages)
      .where(eq(messages.conversationId, 'conv-media'));
    const inbound = allMessages.find((m) => m.messageType === 'incoming');
    expect(inbound?.contentType).toBe('text');
    expect(inbound?.content).toBe('Just text, no media');
  });

  it('skips upload when storage is unavailable', async () => {
    const imageBuffer = Buffer.from('fake-image-data');
    const event = makeEvent({
      content: '',
      media: [
        {
          type: 'image',
          data: imageBuffer,
          mimeType: 'image/png',
        },
      ],
    });

    await handleInboundMessage(
      {
        db,
        scheduler: mockScheduler,
        channels: mockChannels,
        realtime: mockRealtime,
        storage: undefined,
      },
      event,
    );

    // No files uploaded
    expect(uploadedFiles).toHaveLength(0);

    // Message still stored with text fallback (no media result)
    const allMessages = await db.select().from(messages);
    // Without storage, media upload returns null, so content falls back
    expect(allMessages.length).toBeGreaterThanOrEqual(1);
  });
});

// ─── 8. Session upsert ────────────────────────────────────────────

describe('handleInboundMessage — session upsert', () => {
  beforeEach(async () => {
    await db.insert(conversations).values({
      id: 'conv-session',
      channelRoutingId: 'cr-wa',
      contactId: 'contact-1',
      agentId: 'agent-1',
      channelInstanceId: 'ci-wa',
      assignee: 'agent:agent-1',
      status: 'active',
    });
  });

  it('creates channel session for WhatsApp with messaging window', async () => {
    const event = makeEvent({ content: 'Trigger session upsert' });

    await handleInboundMessage(
      {
        db,
        scheduler: mockScheduler,
        channels: mockChannels,
        realtime: mockRealtime,
        storage: mockStorage,
      },
      event,
    );

    // WhatsApp adapter has messagingWindow: true -> session should be created
    const sessions = await db.select().from(channelSessions);
    expect(sessions).toHaveLength(1);
    expect(sessions[0].conversationId).toBe('conv-session');
    expect(sessions[0].channelInstanceId).toBe('ci-wa');
    expect(sessions[0].channelType).toBe('whatsapp');
    expect(sessions[0].sessionState).toBe('window_open');
  });

  it('does not create session for web channel without messaging window', async () => {
    await db.insert(conversations).values({
      id: 'conv-web',
      channelRoutingId: 'cr-web',
      contactId: 'contact-1',
      agentId: 'agent-1',
      channelInstanceId: 'ci-web',
      assignee: 'agent:agent-1',
      status: 'active',
    });

    const event = makeEvent({
      content: 'Web message',
      channelInstanceId: 'ci-web',
      channel: 'web',
    });

    await handleInboundMessage(
      {
        db,
        scheduler: mockScheduler,
        channels: mockChannels,
        realtime: mockRealtime,
        storage: mockStorage,
      },
      event,
    );

    // Web adapter has messagingWindow: false -> no session
    const sessions = await db
      .select()
      .from(channelSessions)
      .where(eq(channelSessions.conversationId, 'conv-web'));
    expect(sessions).toHaveLength(0);
  });
});

// ─── 9. Interactive action handling ───────────────────────────────

describe('handleInboundAction', () => {
  beforeEach(async () => {
    await db.insert(contacts).values({
      id: 'contact-action',
      phone: '+6500000000',
      name: 'Action Test Contact',
      role: 'customer',
    });
    await db.insert(conversations).values({
      id: 'conv-action',
      channelRoutingId: 'cr-wa',
      contactId: 'contact-action',
      agentId: 'agent-1',
      channelInstanceId: 'ci-wa',
      assignee: 'agent:agent-1',
      status: 'active',
    });
  });

  it('schedules agent-wake job and stores action as message', async () => {
    await handleInboundAction(
      { db, scheduler: mockScheduler, realtime: mockRealtime },
      {
        threadId: 'conv-action',
        actionId: `chat:${JSON.stringify({ action: 'confirm', label: 'Confirm Booking' })}`,
      },
    );

    const replyJob = schedulerJobs.find((j) => j.name === 'agents:agent-wake');
    expect(replyJob).toBeDefined();
    expect((replyJob?.data as { conversationId: string }).conversationId).toBe(
      'conv-action',
    );

    // Verify the action was stored as an inbound message
    const [actionMsg] = await db
      .select()
      .from(messages)
      .where(eq(messages.conversationId, 'conv-action'));
    expect(actionMsg).toBeDefined();
    expect(actionMsg.content).toBe('[Button: Confirm Booking]');
    expect(actionMsg.contentType).toBe('interactive');
  });

  it('ignores action without chat: prefix', async () => {
    await handleInboundAction(
      { db, scheduler: mockScheduler, realtime: mockRealtime },
      {
        threadId: 'conv-action',
        actionId: 'other:some-data',
      },
    );

    expect(schedulerJobs).toHaveLength(0);
  });

  it('handles missing actionId gracefully', async () => {
    await handleInboundAction(
      { db, scheduler: mockScheduler, realtime: mockRealtime },
      {
        threadId: 'conv-action',
        actionId: '',
      },
    );

    expect(schedulerJobs).toHaveLength(0);
  });
});

// ─── 10. Reply-link tiebreak ──────────────────────────────────────

describe('reply-link tiebreak — automation vs broadcast', () => {
  async function seedAutomationRecipient(opts: {
    contactId: string;
    phone: string;
    sentAt: Date;
    status?: string;
  }) {
    const [rule] = await db
      .insert(automationRules)
      .values({
        name: 'Tiebreak Rule',
        type: 'recurring',
        channelInstanceId: 'ci-wa',
        audienceFilter: {},
        parameters: {},
        parameterSchema: {},
        timezone: 'UTC',
        createdBy: 'system',
      })
      .returning();

    const [execution] = await db
      .insert(automationExecutions)
      .values({ ruleId: rule.id, stepSequence: 1, status: 'running' })
      .returning();

    const [recipient] = await db
      .insert(automationRecipients)
      .values({
        executionId: execution.id,
        ruleId: rule.id,
        contactId: opts.contactId,
        phone: opts.phone,
        variables: {},
        status: opts.status ?? 'sent',
        sentAt: opts.sentAt,
      })
      .returning();

    return { rule, execution, recipient };
  }

  async function seedBroadcastRecipient(opts: {
    contactId: string;
    phone: string;
    sentAt: Date;
    status?: string;
  }) {
    const [broadcast] = await db
      .insert(broadcasts)
      .values({
        name: 'Tiebreak Broadcast',
        channelInstanceId: 'ci-wa',
        templateId: 'tmpl',
        templateName: 'T',
        templateLanguage: 'en',
        status: 'completed',
        createdBy: 'system',
      })
      .returning();

    const [recipient] = await db
      .insert(broadcastRecipients)
      .values({
        broadcastId: broadcast.id,
        contactId: opts.contactId,
        phone: opts.phone,
        variables: {},
        status: opts.status ?? 'sent',
        sentAt: opts.sentAt,
      })
      .returning();

    return { broadcast, recipient };
  }

  it('automation-only: marks recipient replied and sets ruleId in metadata', async () => {
    await db.insert(contacts).values({
      id: 'tb-auto',
      phone: '+6571111111',
      role: 'customer',
    });

    const { automation: _a, recipient } = await seedAutomationRecipient({
      contactId: 'tb-auto',
      phone: '+6571111111',
      sentAt: new Date(Date.now() - 1 * 60 * 60 * 1000), // 1h ago
    }).then((r) => ({ automation: r, recipient: r.recipient }));

    await handleInboundMessage(
      {
        db,
        scheduler: mockScheduler,
        channels: mockChannels,
        realtime: mockRealtime,
        storage: mockStorage,
      },
      makeEvent({ from: '+6571111111', messageId: 'msg-tb-auto-1' }),
    );

    // Recipient marked replied
    const [updated] = await db
      .select({ status: automationRecipients.status })
      .from(automationRecipients)
      .where(eq(automationRecipients.id, recipient.id));
    expect(updated.status).toBe('replied');

    // Conversation metadata has ruleId
    const convs = await db.select().from(conversations);
    expect(convs).toHaveLength(1);
    const meta = convs[0].metadata as Record<string, unknown>;
    expect(meta.ruleId).toBeDefined();
    expect(meta.broadcastId).toBeUndefined();
  });

  it('broadcast-only: existing behavior preserved — sets broadcastId in metadata', async () => {
    await db.insert(contacts).values({
      id: 'tb-broad',
      phone: '+6572222222',
      role: 'customer',
    });

    const { broadcast, recipient } = await seedBroadcastRecipient({
      contactId: 'tb-broad',
      phone: '+6572222222',
      sentAt: new Date(Date.now() - 1 * 60 * 60 * 1000), // 1h ago
    });

    await handleInboundMessage(
      {
        db,
        scheduler: mockScheduler,
        channels: mockChannels,
        realtime: mockRealtime,
        storage: mockStorage,
      },
      makeEvent({ from: '+6572222222', messageId: 'msg-tb-broad-1' }),
    );

    const convs = await db.select().from(conversations);
    expect(convs).toHaveLength(1);
    const meta = convs[0].metadata as Record<string, unknown>;
    expect(meta.broadcastId).toBe(broadcast.id);
    expect(meta.ruleId).toBeUndefined();

    // Broadcast recipient status unchanged (no replied status on broadcasts)
    const [brecip] = await db
      .select({ status: broadcastRecipients.status })
      .from(broadcastRecipients)
      .where(eq(broadcastRecipients.id, recipient.id));
    expect(brecip.status).toBe('sent');
  });

  it('both match — automation more recent wins; broadcast recipient untouched', async () => {
    await db.insert(contacts).values({
      id: 'tb-both',
      phone: '+6573333333',
      role: 'customer',
    });

    const { recipient: breadRecip } = await seedBroadcastRecipient({
      contactId: 'tb-both',
      phone: '+6573333333',
      sentAt: new Date(Date.now() - 2 * 60 * 60 * 1000), // 2h ago
    });

    const { recipient: autoRecip, rule } = await seedAutomationRecipient({
      contactId: 'tb-both',
      phone: '+6573333333',
      sentAt: new Date(Date.now() - 30 * 60 * 1000), // 30m ago — more recent
    });

    await handleInboundMessage(
      {
        db,
        scheduler: mockScheduler,
        channels: mockChannels,
        realtime: mockRealtime,
        storage: mockStorage,
      },
      makeEvent({ from: '+6573333333', messageId: 'msg-tb-both-1' }),
    );

    // Automation wins — ruleId in metadata
    const convs = await db.select().from(conversations);
    expect(convs).toHaveLength(1);
    const meta = convs[0].metadata as Record<string, unknown>;
    expect(meta.ruleId).toBe(rule.id);
    expect(meta.broadcastId).toBeUndefined();

    // Automation recipient marked replied
    const [ar] = await db
      .select({ status: automationRecipients.status })
      .from(automationRecipients)
      .where(eq(automationRecipients.id, autoRecip.id));
    expect(ar.status).toBe('replied');

    // Broadcast recipient untouched
    const [br] = await db
      .select({ status: broadcastRecipients.status })
      .from(broadcastRecipients)
      .where(eq(broadcastRecipients.id, breadRecip.id));
    expect(br.status).toBe('sent');
  });
});
