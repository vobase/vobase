import { beforeEach, describe, expect, it } from 'bun:test';
import type { ChannelAdapter, OutboundMessage, VobaseDb } from '@vobase/core';
import { eq } from 'drizzle-orm';

import { createTestDb } from '../../../lib/test-helpers';
import {
  channelInstances,
  channelRoutings,
  contacts,
  conversations,
  messages,
} from '../schema';
import {
  isCircuitOpen,
  processDelivery,
  recordCircuitFailure,
  recordCircuitSuccess,
  resetCircuit,
  resolveIdentifierField,
} from './delivery';
import { setModuleDeps } from './deps';

// Use a unique channel key per test group to avoid cross-test state
const ch = (suffix: string) => `test-circuit-${suffix}`;

describe('circuit breaker', () => {
  it('circuit starts closed', () => {
    const key = ch('start');
    expect(isCircuitOpen(key)).toBe(false);
  });

  it('recordCircuitFailure opens circuit after 5 failures', () => {
    const key = ch('open');
    resetCircuit(key);

    for (let i = 0; i < 4; i++) {
      recordCircuitFailure(key);
      expect(isCircuitOpen(key)).toBe(false);
    }

    recordCircuitFailure(key); // 5th failure
    expect(isCircuitOpen(key)).toBe(true);
  });

  it('recordCircuitSuccess resets failures', () => {
    const key = ch('success');
    resetCircuit(key);

    for (let i = 0; i < 4; i++) {
      recordCircuitFailure(key);
    }

    recordCircuitSuccess(key);
    expect(isCircuitOpen(key)).toBe(false);

    // After reset, need another 5 failures to open
    for (let i = 0; i < 4; i++) {
      recordCircuitFailure(key);
    }
    expect(isCircuitOpen(key)).toBe(false);

    recordCircuitFailure(key);
    expect(isCircuitOpen(key)).toBe(true);
  });

  it('resetCircuit clears state', () => {
    const key = ch('reset');

    for (let i = 0; i < 5; i++) {
      recordCircuitFailure(key);
    }
    expect(isCircuitOpen(key)).toBe(true);

    resetCircuit(key);
    expect(isCircuitOpen(key)).toBe(false);
  });

  it('isCircuitOpen returns false after timeout (60s)', () => {
    const key = ch('timeout');
    resetCircuit(key);

    for (let i = 0; i < 5; i++) {
      recordCircuitFailure(key);
    }
    expect(isCircuitOpen(key)).toBe(true);

    // Mock Date.now to be 61s in the future
    const origNow = Date.now;
    try {
      Date.now = () => origNow() + 61_000;
      expect(isCircuitOpen(key)).toBe(false);
    } finally {
      Date.now = origNow;
    }
  });
});

// ─── Adapter-driven delivery tests ─────────────────────────────────

const sentMessages: OutboundMessage[] = [];

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
  serializeOutbound(message) {
    return {
      to: '',
      text: message.content,
      metadata: { serialized: true },
    };
  },
  async send(message) {
    sentMessages.push(message);
    return { success: true, messageId: 'wa-msg-1' };
  },
};

const mockEmailAdapter: ChannelAdapter = {
  name: 'email',
  inboundMode: 'push',
  capabilities: {
    templates: false,
    media: false,
    reactions: false,
    readReceipts: false,
    typingIndicators: false,
    streaming: false,
    messagingWindow: false,
  },
  contactIdentifierField: 'email',
  deliveryModel: 'queued',
  async send(message) {
    sentMessages.push(message);
    return { success: true, messageId: 'email-msg-1' };
  },
};

const adapterMap = new Map<string, ChannelAdapter>([
  ['whatsapp', mockWaAdapter],
  ['email', mockEmailAdapter],
]);

const mockChannels = {
  email: { send: mockEmailAdapter.send.bind(mockEmailAdapter) },
  whatsapp: { send: mockWaAdapter.send.bind(mockWaAdapter) },
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
  onProvision() {},
  async provision() {
    throw new Error('not implemented');
  },
} as never;

const schedulerJobs: Array<{ name: string; data: unknown }> = [];
const mockScheduler = {
  async add(name: string, data: unknown) {
    schedulerJobs.push({ name, data });
  },
  async send() {
    return null;
  },
  async schedule() {},
  async unschedule() {},
  async stop() {},
} as never;

const mockRealtime = {
  notify: async () => {},
} as never;

describe('adapter-driven delivery', () => {
  let db: VobaseDb;

  beforeEach(async () => {
    const result = await createTestDb();
    db = result.db;
    sentMessages.length = 0;
    schedulerJobs.length = 0;
    resetCircuit('whatsapp');
    resetCircuit('email');

    setModuleDeps({
      db,
      scheduler: mockScheduler,
      channels: mockChannels,
      realtime: mockRealtime,
    });

    await db.insert(contacts).values({
      id: 'contact-1',
      phone: '+6591234567',
      email: 'test@example.com',
      name: 'Test Customer',
      role: 'customer',
    });

    await db.insert(channelInstances).values([
      { id: 'ci-wa', type: 'whatsapp', label: 'WhatsApp', source: 'env' },
      { id: 'ci-email', type: 'email', label: 'Email', source: 'env' },
    ]);

    await db.insert(channelRoutings).values([
      {
        id: 'cr-wa',
        name: 'WA Routing',
        channelInstanceId: 'ci-wa',
        agentId: 'agent-1',
      },
      {
        id: 'cr-email',
        name: 'Email Routing',
        channelInstanceId: 'ci-email',
        agentId: 'agent-1',
      },
    ]);

    await db.insert(conversations).values([
      {
        id: 'conv-wa',
        channelRoutingId: 'cr-wa',
        contactId: 'contact-1',
        agentId: 'agent-1',
        channelInstanceId: 'ci-wa',
        assignee: 'agent:agent-1',
        status: 'active',
      },
      {
        id: 'conv-email',
        channelRoutingId: 'cr-email',
        contactId: 'contact-1',
        agentId: 'agent-1',
        channelInstanceId: 'ci-email',
        assignee: 'agent:agent-1',
        status: 'active',
      },
    ]);
  });

  it('dispatches through adapter.serializeOutbound for WhatsApp', async () => {
    await db.insert(messages).values({
      id: 'msg-wa-1',
      conversationId: 'conv-wa',
      messageType: 'outgoing',
      contentType: 'text',
      content: 'Hello customer',
      status: 'queued',
      senderId: 'agent-1',
      senderType: 'agent',
      channelType: 'whatsapp',
    });

    await processDelivery(db, mockChannels, mockScheduler, 'msg-wa-1');

    expect(sentMessages).toHaveLength(1);
    expect(sentMessages[0].text).toBe('Hello customer');
    expect(sentMessages[0].to).toBe('+6591234567');
    expect(sentMessages[0].metadata).toMatchObject({ serialized: true });

    const [updated] = await db
      .select()
      .from(messages)
      .where(eq(messages.id, 'msg-wa-1'));
    expect(updated.status).toBe('sent');
    expect(updated.externalMessageId).toBe('wa-msg-1');
  });

  it('uses adapter.contactIdentifierField for email address', async () => {
    await db.insert(messages).values({
      id: 'msg-email-1',
      conversationId: 'conv-email',
      messageType: 'outgoing',
      contentType: 'text',
      content: 'Hello via email',
      status: 'queued',
      senderId: 'agent-1',
      senderType: 'agent',
      channelType: 'email',
    });

    await processDelivery(db, mockChannels, mockScheduler, 'msg-email-1');

    expect(sentMessages).toHaveLength(1);
    expect(sentMessages[0].to).toBe('test@example.com');
  });

  it('marks web channel messages as sent without adapter call', async () => {
    await db.insert(channelInstances).values({
      id: 'ci-web',
      type: 'web',
      label: 'Web',
      source: 'env',
    });

    await db.insert(channelRoutings).values({
      id: 'cr-web',
      name: 'Web Routing',
      channelInstanceId: 'ci-web',
      agentId: 'agent-1',
    });

    await db.insert(conversations).values({
      id: 'conv-web',
      channelRoutingId: 'cr-web',
      contactId: 'contact-1',
      agentId: 'agent-1',
      channelInstanceId: 'ci-web',
      assignee: 'agent:agent-1',
      status: 'active',
    });

    await db.insert(messages).values({
      id: 'msg-web-1',
      conversationId: 'conv-web',
      messageType: 'outgoing',
      contentType: 'text',
      content: 'Hello web user',
      status: 'queued',
      senderId: 'agent-1',
      senderType: 'agent',
      channelType: 'web',
    });

    await processDelivery(db, mockChannels, mockScheduler, 'msg-web-1');

    expect(sentMessages).toHaveLength(0);

    const [updated] = await db
      .select()
      .from(messages)
      .where(eq(messages.id, 'msg-web-1'));
    expect(updated.status).toBe('sent');
  });

  it('fails when contact lacks required identifier', async () => {
    await db.insert(contacts).values({
      id: 'contact-nophone',
      name: 'No Phone',
      role: 'customer',
    });

    await db.insert(conversations).values({
      id: 'conv-nophone',
      channelRoutingId: 'cr-wa',
      contactId: 'contact-nophone',
      agentId: 'agent-1',
      channelInstanceId: 'ci-wa',
      assignee: 'agent:agent-1',
      status: 'active',
    });

    await db.insert(messages).values({
      id: 'msg-nophone',
      conversationId: 'conv-nophone',
      messageType: 'outgoing',
      contentType: 'text',
      content: 'This should fail',
      status: 'queued',
      senderId: 'agent-1',
      senderType: 'agent',
      channelType: 'whatsapp',
    });

    await processDelivery(db, mockChannels, mockScheduler, 'msg-nophone');

    const [updated] = await db
      .select()
      .from(messages)
      .where(eq(messages.id, 'msg-nophone'));
    expect(updated.status).toBe('failed');
    expect(updated.failureReason).toContain('phone');
  });
});

describe('resolveIdentifierField', () => {
  it('returns phone for whatsapp', () => {
    expect(resolveIdentifierField('whatsapp')).toBe('phone');
  });

  it('returns email for email/resend/smtp', () => {
    expect(resolveIdentifierField('email')).toBe('email');
    expect(resolveIdentifierField('resend')).toBe('email');
    expect(resolveIdentifierField('smtp')).toBe('email');
  });

  it('returns identifier for unknown channels', () => {
    expect(resolveIdentifierField('telegram')).toBe('identifier');
  });
});
