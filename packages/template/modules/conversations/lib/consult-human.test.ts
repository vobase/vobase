import { afterEach, beforeEach, describe, expect, it } from 'bun:test';
import type { PGlite } from '@electric-sql/pglite';
import type { VobaseDb } from '@vobase/core';
import { eq } from 'drizzle-orm';

import { createTestDb } from '../../../lib/test-helpers';
import { contacts } from '../../contacts/schema';
import {
  channelInstances,
  channelRoutings,
  consultations,
  conversations,
} from '../schema';
import { handleStaffReply, requestConsultation } from './consult-human';

let pglite: PGlite;
let db: VobaseDb;

beforeEach(async () => {
  const result = await createTestDb();
  pglite = result.pglite as unknown as PGlite;
  db = result.db;

  // Seed required data
  await db.insert(contacts).values([
    {
      id: 'contact-cust',
      phone: '+6591234567',
      name: 'Customer',
      role: 'customer',
    },
    {
      id: 'contact-staff',
      phone: '+6598765432',
      email: 'staff@example.com',
      name: 'Staff Member',
      role: 'staff',
    },
  ]);

  await db.insert(channelInstances).values({
    id: 'ci-wa-1',
    type: 'whatsapp',
    label: 'WhatsApp Main',
    source: 'env',
    status: 'active',
  });

  await db.insert(channelRoutings).values({
    id: 'ep-wa-1',
    name: 'WhatsApp Booking',
    channelInstanceId: 'ci-wa-1',
    agentId: 'booking',
  });

  await db.insert(conversations).values({
    id: 'session-1',
    channelRoutingId: 'ep-wa-1',
    contactId: 'contact-cust',
    agentId: 'booking',
    channelInstanceId: 'ci-wa-1',
    status: 'active',
  });
});

afterEach(async () => {
  await (pglite as unknown as { close: () => Promise<void> }).close();
});

const mockRealtime = {
  notify: async () => {},
} as never;

describe('requestConsultation', () => {
  it('creates consultation with channelType and channelInstanceId', async () => {
    const mockChannels = {
      whatsapp: { send: async () => ({ success: true }) },
      email: { send: async () => ({ success: true }) },
    } as never;

    const consultation = await requestConsultation(
      {
        db,
        scheduler: {} as never,
        channels: mockChannels,
        realtime: mockRealtime,
      },
      {
        conversationId: 'session-1',
        staffContactId: 'contact-staff',
        channelType: 'whatsapp',
        channelInstanceId: 'ci-wa-1',
        reason: 'Need human help',
        message: 'Customer has a complex question',
      },
    );

    expect(consultation.channelType).toBe('whatsapp');
    expect(consultation.channelInstanceId).toBe('ci-wa-1');
    expect(consultation.status).toBe('pending');
    expect(consultation.reason).toBe('Need human help');
  });

  it('creates consultation without channelInstanceId', async () => {
    const mockChannels = {
      whatsapp: { send: async () => ({ success: true }) },
      email: { send: async () => ({ success: true }) },
    } as never;

    const consultation = await requestConsultation(
      {
        db,
        scheduler: {} as never,
        channels: mockChannels,
        realtime: mockRealtime,
      },
      {
        conversationId: 'session-1',
        staffContactId: 'contact-staff',
        channelType: 'email',
        reason: 'Escalation needed',
        message: 'Customer wants refund',
      },
    );

    expect(consultation.channelType).toBe('email');
    expect(consultation.channelInstanceId).toBeNull();
  });

  it('returns existing pending consultation instead of creating duplicate', async () => {
    const mockChannels = {
      whatsapp: { send: async () => ({ success: true }) },
    } as never;

    const deps = {
      db,
      scheduler: {} as never,
      channels: mockChannels,
      realtime: mockRealtime,
    };
    const input = {
      conversationId: 'session-1',
      staffContactId: 'contact-staff',
      channelType: 'whatsapp',
      channelInstanceId: 'ci-wa-1',
      reason: 'Help',
      message: 'Question',
    };

    const first = await requestConsultation(deps, input);
    const second = await requestConsultation(deps, input);

    expect(first.id).toBe(second.id);
  });
});

describe('handleStaffReply', () => {
  it('returns false when consultation is already timed out (atomic check)', async () => {
    // Insert a consultation that is already timed out (not pending)
    const [timedOut] = await db
      .insert(consultations)
      .values({
        conversationId: 'session-1',
        staffContactId: 'contact-staff',
        channelType: 'whatsapp',
        channelInstanceId: 'ci-wa-1',
        reason: 'Help needed',
        status: 'timeout',
      })
      .returning();

    const mockChannels = {
      whatsapp: { send: async () => ({ success: true }) },
    } as never;

    const deps = {
      db,
      scheduler: {} as never,
      channels: mockChannels,
      realtime: mockRealtime,
    };

    const mockEvent = {
      channel: 'whatsapp',
      from: '+6598765432',
      content: 'Staff reply after timeout',
      timestamp: new Date().toISOString(),
    } as never;

    const result = await handleStaffReply(deps, timedOut, mockEvent);

    // Should return false — the atomic WHERE status='pending' found no rows
    expect(result).toBe(false);

    // Consultation status should remain 'timeout', not 'replied'
    const [unchanged] = await db
      .select()
      .from(consultations)
      .where(eq(consultations.id, timedOut.id));
    expect(unchanged.status).toBe('timeout');
  });
});
