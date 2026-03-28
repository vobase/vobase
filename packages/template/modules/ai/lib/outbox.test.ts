import { afterEach, beforeEach, describe, expect, it } from 'bun:test';
import type { PGlite } from '@electric-sql/pglite';
import type { VobaseDb } from '@vobase/core';
import { eq, sql } from 'drizzle-orm';

import { createTestDb } from '../../../lib/test-helpers';
import {
  channelInstances,
  channelRoutings,
  contacts,
  conversations,
  deadLetters,
  outbox,
} from '../schema';
import { enqueueMessage, MAX_RETRIES, processOutboxMessage } from './outbox';

let pglite: PGlite;
let db: VobaseDb;

const mockScheduler = {
  add: async () => ({ id: 'job-1' }),
} as never;

beforeEach(async () => {
  const result = await createTestDb();
  pglite = result.pglite as unknown as PGlite;
  db = result.db;

  // Seed required data
  await db.insert(contacts).values({
    id: 'contact-1',
    phone: '+6591234567',
    email: 'test@example.com',
    name: 'Test Customer',
    role: 'customer',
  });

  await db.insert(channelInstances).values([
    {
      id: 'ci-wa-1',
      type: 'whatsapp',
      label: 'WhatsApp Main',
      source: 'env',
      status: 'active',
    },
    {
      id: 'ci-web-1',
      type: 'web',
      label: 'Web Chat',
      source: 'env',
      status: 'active',
    },
  ]);

  await db.insert(channelRoutings).values({
    id: 'ep-wa-1',
    name: 'WhatsApp Booking',
    channelInstanceId: 'ci-wa-1',
    agentId: 'booking',
  });

  await db.insert(conversations).values({
    id: 'session-1',
    channelRoutingId: 'ep-wa-1',
    contactId: 'contact-1',
    agentId: 'booking',
    channelInstanceId: 'ci-wa-1',
    status: 'active',
  });
});

// Singleton PGlite — never close; process exit handles cleanup

describe('enqueueMessage', () => {
  it('enqueues with channelType and channelInstanceId', async () => {
    const record = await enqueueMessage(db, mockScheduler, {
      conversationId: 'session-1',
      content: 'Hello',
      channelType: 'whatsapp',
      channelInstanceId: 'ci-wa-1',
    });

    expect(record.channelType).toBe('whatsapp');
    expect(record.channelInstanceId).toBe('ci-wa-1');
    expect(record.status).toBe('queued');
    expect(record.content).toBe('Hello');
  });

  it('enqueues without channelInstanceId (nullable)', async () => {
    const record = await enqueueMessage(db, mockScheduler, {
      conversationId: 'session-1',
      content: 'Hello web',
      channelType: 'web',
    });

    expect(record.channelType).toBe('web');
    expect(record.channelInstanceId).toBeNull();
  });
});

describe('processOutboxMessage', () => {
  it('dispatches whatsapp messages by channelType', async () => {
    // Enqueue a message
    const [record] = await db
      .insert(outbox)
      .values({
        id: 'outbox-1',
        conversationId: 'session-1',
        content: 'Test message',
        channelType: 'whatsapp',
        channelInstanceId: 'ci-wa-1',
        status: 'queued',
      })
      .returning();

    // Mock channels service
    const mockChannels = {
      whatsapp: {
        send: async () => ({ success: true, messageId: 'wa-msg-1' }),
      },
      email: { send: async () => ({ success: true }) },
    } as never;

    await processOutboxMessage(db, mockChannels, mockScheduler, record.id);

    // Verify status updated
    const [updated] = await db
      .select()
      .from(outbox)
      .where(eq(outbox.id, record.id));

    expect(updated.status).toBe('sent');
    expect(updated.externalMessageId).toBe('wa-msg-1');
  });

  it('marks web messages as sent without external delivery', async () => {
    // Create web conversation
    await db.insert(channelRoutings).values({
      id: 'ep-web-1',
      name: 'Web',
      channelInstanceId: 'ci-web-1',
      agentId: 'booking',
    });
    await db.insert(conversations).values({
      id: 'session-web',
      channelRoutingId: 'ep-web-1',
      contactId: 'contact-1',
      agentId: 'booking',
      channelInstanceId: 'ci-web-1',
      status: 'active',
    });

    const [record] = await db
      .insert(outbox)
      .values({
        id: 'outbox-web',
        conversationId: 'session-web',
        content: 'Web message',
        channelType: 'web',
        channelInstanceId: 'ci-web-1',
        status: 'queued',
      })
      .returning();

    const mockChannels = {} as never;
    await processOutboxMessage(db, mockChannels, mockScheduler, record.id);

    const [updated] = await db
      .select()
      .from(outbox)
      .where(eq(outbox.id, record.id));

    expect(updated.status).toBe('sent');
  });

  it('moves to dead_letters when contact is missing', async () => {
    // Insert a conversation with contact-1, then patch contact_id via raw SQL to bypass FK
    await db.insert(channelRoutings).values({
      id: 'ep-temp',
      name: 'Temp',
      channelInstanceId: 'ci-wa-1',
      agentId: 'booking',
    });
    await db.insert(conversations).values({
      id: 'session-nocontact',
      channelRoutingId: 'ep-temp',
      contactId: 'contact-1', // valid FK for insert
      agentId: 'booking',
      channelInstanceId: 'ci-wa-1',
      status: 'active',
    });

    const [record] = await db
      .insert(outbox)
      .values({
        id: 'outbox-nocontact',
        conversationId: 'session-nocontact',
        content: 'Orphaned message',
        channelType: 'whatsapp',
        channelInstanceId: 'ci-wa-1',
        status: 'queued',
      })
      .returning();

    // Patch contact_id to a nonexistent value bypassing FK (deferred constraint)
    await db.execute(sql`SET session_replication_role = replica`);
    await db.execute(
      sql`UPDATE conversations.conversations SET contact_id = 'ghost-contact' WHERE id = 'session-nocontact'`,
    );
    await db.execute(sql`SET session_replication_role = DEFAULT`);

    const mockChannels = {} as never;
    await processOutboxMessage(db, mockChannels, mockScheduler, record.id);

    // Outbox record should be deleted
    const [remaining] = await db
      .select()
      .from(outbox)
      .where(eq(outbox.id, record.id));
    expect(remaining).toBeUndefined();

    // Dead letter should be created with correct reason
    const [dead] = await db
      .select()
      .from(deadLetters)
      .where(eq(deadLetters.originalOutboxId, record.id));
    expect(dead).toBeDefined();
    expect(dead.error).toBe('Contact not found');
  });

  it('moves to dead_letters when MAX_RETRIES exceeded', async () => {
    const [record] = await db
      .insert(outbox)
      .values({
        id: 'outbox-maxretry',
        conversationId: 'session-1',
        content: 'Retry exhausted',
        channelType: 'whatsapp',
        channelInstanceId: 'ci-wa-1',
        status: 'queued',
        retryCount: MAX_RETRIES - 1, // one more failure should dead-letter
      })
      .returning();

    // Channel returns failure
    const mockChannels = {
      whatsapp: {
        send: async () => ({ success: false, error: 'upstream error' }),
      },
    } as never;

    await processOutboxMessage(db, mockChannels, mockScheduler, record.id);

    // Outbox record should be gone
    const [remaining] = await db
      .select()
      .from(outbox)
      .where(eq(outbox.id, record.id));
    expect(remaining).toBeUndefined();

    // Dead letter should exist
    const [dead] = await db
      .select()
      .from(deadLetters)
      .where(eq(deadLetters.originalOutboxId, record.id));
    expect(dead).toBeDefined();
    expect(dead.status).toBe('dead');
  });
});
