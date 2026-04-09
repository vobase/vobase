import { beforeEach, describe, expect, it } from 'bun:test';
import type { VobaseDb } from '@vobase/core';
import { eq } from 'drizzle-orm';

import { createTestDb } from '../../../lib/test-helpers';
import {
  channelInstances,
  channelRoutings,
  channelSessions,
  contacts,
  interactions,
} from '../schema';
import { checkWindow, expireSessions, upsertSession } from './channel-sessions';

let db: VobaseDb;

// Seed data IDs
const CONTACT_ID = 'test-cnt-01';
const INSTANCE_ID = 'test-inst-01';
const ROUTING_ID = 'test-rte-01';
const CONV_ID = 'test-conv-01';

async function seedTestData() {
  await db.insert(contacts).values({
    id: CONTACT_ID,
    phone: '+6591234567',
    name: 'Test User',
    role: 'customer',
  });
  await db.insert(channelInstances).values({
    id: INSTANCE_ID,
    type: 'whatsapp',
    label: 'WhatsApp',
    source: 'env',
    status: 'active',
  });
  await db.insert(channelRoutings).values({
    id: ROUTING_ID,
    name: 'Default',
    channelInstanceId: INSTANCE_ID,
    agentId: 'test-agent',
  });
  await db.insert(interactions).values({
    id: CONV_ID,
    channelRoutingId: ROUTING_ID,
    contactId: CONTACT_ID,
    agentId: 'test-agent',
    channelInstanceId: INSTANCE_ID,
    status: 'active',
  });
}

beforeEach(async () => {
  const result = await createTestDb();
  db = result.db;
  await seedTestData();
});

describe('upsertSession', () => {
  it('creates a new session with window_open state', async () => {
    await upsertSession(db, {
      interactionId: CONV_ID,
      channelInstanceId: INSTANCE_ID,
      channelType: 'whatsapp',
    });

    const [session] = await db
      .select()
      .from(channelSessions)
      .where(eq(channelSessions.interactionId, CONV_ID));

    expect(session).toBeDefined();
    expect(session.sessionState).toBe('window_open');
    expect(session.channelType).toBe('whatsapp');
    expect(session.windowExpiresAt.getTime()).toBeGreaterThan(Date.now());
  });

  it('upserts existing session (refreshes window)', async () => {
    // First upsert
    await upsertSession(db, {
      interactionId: CONV_ID,
      channelInstanceId: INSTANCE_ID,
      channelType: 'whatsapp',
    });

    const [first] = await db
      .select()
      .from(channelSessions)
      .where(eq(channelSessions.interactionId, CONV_ID));

    // Small delay to get different timestamps
    await new Promise((r) => setTimeout(r, 10));

    // Second upsert — should update, not create duplicate
    await upsertSession(db, {
      interactionId: CONV_ID,
      channelInstanceId: INSTANCE_ID,
      channelType: 'whatsapp',
    });

    const all = await db
      .select()
      .from(channelSessions)
      .where(eq(channelSessions.interactionId, CONV_ID));

    expect(all).toHaveLength(1);
    expect(all[0].windowExpiresAt.getTime()).toBeGreaterThanOrEqual(
      first.windowExpiresAt.getTime(),
    );
  });
});

describe('checkWindow', () => {
  it('returns isOpen=false when no session exists', async () => {
    const result = await checkWindow(db, CONV_ID);
    expect(result.isOpen).toBe(false);
    expect(result.expiresAt).toBeNull();
  });

  it('returns isOpen=true for active session', async () => {
    await upsertSession(db, {
      interactionId: CONV_ID,
      channelInstanceId: INSTANCE_ID,
      channelType: 'whatsapp',
    });

    const result = await checkWindow(db, CONV_ID);
    expect(result.isOpen).toBe(true);
    expect(result.expiresAt).not.toBeNull();
  });

  it('returns isOpen=false for expired session', async () => {
    // Insert a session that already expired
    const pastExpiry = new Date(Date.now() - 1000);
    await db.insert(channelSessions).values({
      interactionId: CONV_ID,
      channelInstanceId: INSTANCE_ID,
      channelType: 'whatsapp',
      sessionState: 'window_open',
      windowOpensAt: new Date(Date.now() - 25 * 60 * 60 * 1000),
      windowExpiresAt: pastExpiry,
    });

    const result = await checkWindow(db, CONV_ID);
    expect(result.isOpen).toBe(false);
  });
});

describe('expireSessions', () => {
  it('bulk-expires sessions past their window', async () => {
    // Insert an expired session (windowExpiresAt in the past)
    await db.insert(channelSessions).values({
      interactionId: CONV_ID,
      channelInstanceId: INSTANCE_ID,
      channelType: 'whatsapp',
      sessionState: 'window_open',
      windowOpensAt: new Date(Date.now() - 25 * 60 * 60 * 1000),
      windowExpiresAt: new Date(Date.now() - 1000),
    });

    const count = await expireSessions(db);
    expect(count).toBe(1);

    const [session] = await db
      .select()
      .from(channelSessions)
      .where(eq(channelSessions.interactionId, CONV_ID));

    expect(session.sessionState).toBe('window_expired');
  });

  it('does not expire sessions with future window', async () => {
    await upsertSession(db, {
      interactionId: CONV_ID,
      channelInstanceId: INSTANCE_ID,
      channelType: 'whatsapp',
    });

    const count = await expireSessions(db);
    expect(count).toBe(0);

    const [session] = await db
      .select()
      .from(channelSessions)
      .where(eq(channelSessions.interactionId, CONV_ID));

    expect(session.sessionState).toBe('window_open');
  });

  it('skips already expired sessions', async () => {
    await db.insert(channelSessions).values({
      interactionId: CONV_ID,
      channelInstanceId: INSTANCE_ID,
      channelType: 'whatsapp',
      sessionState: 'window_expired',
      windowOpensAt: new Date(Date.now() - 25 * 60 * 60 * 1000),
      windowExpiresAt: new Date(Date.now() - 1000),
    });

    const count = await expireSessions(db);
    expect(count).toBe(0);
  });
});
