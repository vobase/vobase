import { afterEach, beforeEach, describe, expect, it } from 'bun:test';
import type { PGlite } from '@electric-sql/pglite';
import type { VobaseDb } from '@vobase/core';

import { createTestDb } from '../../../lib/test-helpers';
import {
  channelInstances,
  channelRoutings,
  contacts,
  conversations,
  outbox,
} from '../schema';
import {
  isCircuitOpen,
  processOutboxMessage,
  recordCircuitFailure,
  recordCircuitSuccess,
  resetCircuit,
} from './outbox';

let _pglite: PGlite;
let db: VobaseDb;

const mockScheduler = {
  add: async () => ({ id: 'job-1' }),
} as never;

beforeEach(async () => {
  const result = await createTestDb();
  _pglite = result.pglite as unknown as PGlite;
  db = result.db;

  // Reset circuit state for each test
  resetCircuit('whatsapp');
  resetCircuit('email');
  resetCircuit('web');

  await db.insert(contacts).values({
    id: 'contact-cb',
    phone: '+6591234567',
    email: 'test@example.com',
    name: 'Test Customer',
    role: 'customer',
  });

  await db.insert(channelInstances).values({
    id: 'ci-wa-cb',
    type: 'whatsapp',
    label: 'WhatsApp',
    source: 'env',
    status: 'active',
  });

  await db.insert(channelRoutings).values({
    id: 'ep-wa-cb',
    name: 'WhatsApp Booking',
    channelInstanceId: 'ci-wa-cb',
    agentId: 'booking',
  });

  await db.insert(conversations).values({
    id: 'session-cb',
    channelRoutingId: 'ep-wa-cb',
    contactId: 'contact-cb',
    agentId: 'booking',
    channelInstanceId: 'ci-wa-cb',
    status: 'active',
  });
});

afterEach(() => {
  resetCircuit('whatsapp');
});

describe('circuit breaker state', () => {
  it('is closed initially', () => {
    expect(isCircuitOpen('whatsapp')).toBe(false);
  });

  it('opens after 5 consecutive failures', () => {
    for (let i = 0; i < 5; i++) {
      recordCircuitFailure('whatsapp');
    }
    expect(isCircuitOpen('whatsapp')).toBe(true);
  });

  it('does not open after 4 failures', () => {
    for (let i = 0; i < 4; i++) {
      recordCircuitFailure('whatsapp');
    }
    expect(isCircuitOpen('whatsapp')).toBe(false);
  });

  it('resets to closed on success', () => {
    for (let i = 0; i < 5; i++) {
      recordCircuitFailure('whatsapp');
    }
    expect(isCircuitOpen('whatsapp')).toBe(true);
    recordCircuitSuccess('whatsapp');
    expect(isCircuitOpen('whatsapp')).toBe(false);
  });

  it('is independent per channelType', () => {
    for (let i = 0; i < 5; i++) {
      recordCircuitFailure('whatsapp');
    }
    expect(isCircuitOpen('whatsapp')).toBe(true);
    expect(isCircuitOpen('email')).toBe(false);
  });
});

describe('processOutboxMessage circuit breaker integration', () => {
  it('skips send when circuit is open after 5 failures', async () => {
    // Open the circuit
    for (let i = 0; i < 5; i++) {
      recordCircuitFailure('whatsapp');
    }

    const [record] = await db
      .insert(outbox)
      .values({
        id: 'outbox-cb-1',
        conversationId: 'session-cb',
        content: 'Test message',
        channelType: 'whatsapp',
        channelInstanceId: 'ci-wa-cb',
        status: 'queued',
      })
      .returning();

    let sendCalled = false;
    const mockChannels = {
      whatsapp: {
        send: async () => {
          sendCalled = true;
          return { success: true, messageId: 'wa-1' };
        },
      },
    } as never;

    await processOutboxMessage(db, mockChannels, mockScheduler, record.id);

    // send should NOT have been called — circuit skip path was taken
    expect(sendCalled).toBe(false);
  });

  it('allows send when circuit is closed', async () => {
    const [record] = await db
      .insert(outbox)
      .values({
        id: 'outbox-cb-2',
        conversationId: 'session-cb',
        content: 'Test message',
        channelType: 'whatsapp',
        channelInstanceId: 'ci-wa-cb',
        status: 'queued',
      })
      .returning();

    let sendCalled = false;
    const mockChannels = {
      whatsapp: {
        send: async () => {
          sendCalled = true;
          return { success: true, messageId: 'wa-2' };
        },
      },
    } as never;

    await processOutboxMessage(db, mockChannels, mockScheduler, record.id);

    expect(sendCalled).toBe(true);
  });
});
