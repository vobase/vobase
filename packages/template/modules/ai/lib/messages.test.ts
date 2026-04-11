import { beforeEach, describe, expect, it } from 'bun:test';
import type { PGlite } from '@electric-sql/pglite';
import type { VobaseDb } from '@vobase/core';
import { eq } from 'drizzle-orm';

import { createTestDb } from '../../../lib/test-helpers';
import {
  channelInstances,
  channelRoutings,
  contacts,
  conversations,
  messages,
} from '../schema';
import { createActivityMessage, insertMessage } from './messages';

let _pglite: PGlite;
let db: VobaseDb;

const mockRealtime = { notify: async () => {} } as never;

beforeEach(async () => {
  const result = await createTestDb();
  _pglite = result.pglite as unknown as PGlite;
  db = result.db;

  await db.insert(contacts).values({
    id: 'contact-1',
    phone: '+6591234567',
    name: 'Test Customer',
    role: 'customer',
  });

  await db.insert(channelInstances).values({
    id: 'ci-1',
    type: 'whatsapp',
    label: 'WhatsApp',
    source: 'env',
    status: 'active',
  });

  await db.insert(channelRoutings).values({
    id: 'cr-1',
    name: 'WA Routing',
    channelInstanceId: 'ci-1',
    agentId: 'booking',
  });

  await db.insert(conversations).values({
    id: 'conv-1',
    channelRoutingId: 'cr-1',
    contactId: 'contact-1',
    agentId: 'booking',
    channelInstanceId: 'ci-1',
    assignee: 'agent:booking',
    status: 'active',
  });
});

describe('insertMessage', () => {
  it('creates a message row and returns it', async () => {
    const msg = await insertMessage(db, mockRealtime, {
      conversationId: 'conv-1',
      messageType: 'outgoing',
      contentType: 'text',
      content: 'Hello from agent',
      senderId: 'agent-1',
      senderType: 'agent',
    });

    expect(msg.id).toBeTruthy();
    expect(msg.content).toBe('Hello from agent');
    expect(msg.messageType).toBe('outgoing');
    expect(msg.senderType).toBe('agent');

    const [row] = await db
      .select()
      .from(messages)
      .where(eq(messages.id, msg.id));
    expect(row).toBeDefined();
    expect(row.content).toBe('Hello from agent');
  });

  it('updates conversation denormalized fields (lastMessageContent, lastMessageAt, lastMessageType)', async () => {
    await insertMessage(db, mockRealtime, {
      conversationId: 'conv-1',
      messageType: 'outgoing',
      contentType: 'text',
      content: 'Denorm update test',
      senderId: 'agent-1',
      senderType: 'agent',
    });

    const [conv] = await db
      .select()
      .from(conversations)
      .where(eq(conversations.id, 'conv-1'));

    expect(conv.lastMessageContent).toBe('Denorm update test');
    expect(conv.lastMessageAt).not.toBeNull();
    expect(conv.lastMessageType).toBe('outgoing');
  });

  it('increments unreadCount for incoming messages in human mode', async () => {
    // Switch conversation to human mode
    await db
      .update(conversations)
      .set({ assignee: 'user-1' })
      .where(eq(conversations.id, 'conv-1'));

    await insertMessage(db, mockRealtime, {
      conversationId: 'conv-1',
      messageType: 'incoming',
      contentType: 'text',
      content: 'Customer message',
      senderId: 'contact-1',
      senderType: 'contact',
    });

    const [conv] = await db
      .select()
      .from(conversations)
      .where(eq(conversations.id, 'conv-1'));

    expect(conv.unreadCount).toBe(1);
  });

  it('does NOT increment unreadCount for incoming messages in ai mode', async () => {
    // conversation is already in 'ai' mode from seed
    await insertMessage(db, mockRealtime, {
      conversationId: 'conv-1',
      messageType: 'incoming',
      contentType: 'text',
      content: 'Customer message in AI mode',
      senderId: 'contact-1',
      senderType: 'contact',
    });

    const [conv] = await db
      .select()
      .from(conversations)
      .where(eq(conversations.id, 'conv-1'));

    expect(conv.unreadCount).toBe(0);
  });

  it('does NOT increment unreadCount for outgoing messages', async () => {
    await db
      .update(conversations)
      .set({ assignee: 'user-1' })
      .where(eq(conversations.id, 'conv-1'));

    await insertMessage(db, mockRealtime, {
      conversationId: 'conv-1',
      messageType: 'outgoing',
      contentType: 'text',
      content: 'Agent reply',
      senderId: 'agent-1',
      senderType: 'agent',
    });

    const [conv] = await db
      .select()
      .from(conversations)
      .where(eq(conversations.id, 'conv-1'));

    expect(conv.unreadCount).toBe(0);
  });
});

describe('createActivityMessage', () => {
  it('creates an activity-type message with eventType in contentData', async () => {
    const msg = await createActivityMessage(db, mockRealtime, {
      conversationId: 'conv-1',
      eventType: 'interaction.escalated',
      actor: 'agent-1',
      actorType: 'agent',
      data: { reason: 'customer request' },
    });

    expect(msg.messageType).toBe('activity');
    expect(msg.contentType).toBe('system');
    expect(msg.content).toBe('interaction.escalated');
    expect((msg.contentData as Record<string, unknown>).eventType).toBe(
      'interaction.escalated',
    );
    expect((msg.contentData as Record<string, unknown>).actor).toBe('agent-1');

    const [row] = await db
      .select()
      .from(messages)
      .where(eq(messages.id, msg.id));
    expect(row.messageType).toBe('activity');
  });

  it('createActivityMessage with resolutionStatus="pending" sets the column', async () => {
    const msg = await createActivityMessage(db, mockRealtime, {
      conversationId: 'conv-1',
      eventType: 'interaction.needs_review',
      resolutionStatus: 'pending',
    });

    expect(msg.resolutionStatus).toBe('pending');

    const [row] = await db
      .select()
      .from(messages)
      .where(eq(messages.id, msg.id));
    expect(row.resolutionStatus).toBe('pending');
  });
});
