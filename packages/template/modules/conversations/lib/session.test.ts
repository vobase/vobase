/**
 * Tests for session lifecycle: M1 (structured logging), M9 (endpoint validation).
 *
 * Uses initChat with PGlite to properly initialize the state singleton.
 * For M9 (endpoint validation), notFound() throws before reaching getMemory,
 * so no memory stub is needed for those tests.
 */
import { afterEach, beforeEach, describe, expect, it } from 'bun:test';
import type { PGlite } from '@electric-sql/pglite';
import type { VobaseDb } from '@vobase/core';
import { eq } from 'drizzle-orm';

import { createTestDb } from '../../../lib/test-helpers';
import { contacts } from '../../contacts/schema';
import { channelInstances, endpoints, sessions } from '../schema';
import { initChat } from './chat-init';
import { completeSession, createSession, failSession } from './session';

let pglite: PGlite;
let db: VobaseDb;

const mockScheduler = {
  add: async () => ({ id: 'job-1' }),
} as never;

const mockChannels = {} as never;

beforeEach(async () => {
  const result = await createTestDb();
  pglite = result.pglite as unknown as PGlite;
  db = result.db;

  // Initialize chat state so getChatState() works in session functions
  await initChat({ db, scheduler: mockScheduler, channels: mockChannels });

  await db.insert(contacts).values({
    id: 'contact-sess',
    phone: '+6591234567',
    name: 'Test Customer',
    role: 'customer',
  });

  await db.insert(channelInstances).values({
    id: 'ci-sess',
    type: 'web',
    label: 'Web Chat',
    source: 'env',
    status: 'active',
  });

  await db.insert(endpoints).values({
    id: 'ep-sess',
    name: 'Web Endpoint',
    channelInstanceId: 'ci-sess',
    agentId: 'booking',
  });
});

afterEach(async () => {
  await (pglite as unknown as { close: () => Promise<void> }).close();
});

describe('createSession (M9 — endpoint validation)', () => {
  it('throws when endpoint does not exist', async () => {
    // M9: notFound() fires before any memory/DB insert, so no memory stub needed
    let threw = false;
    try {
      await createSession(
        { db, scheduler: mockScheduler },
        {
          endpointId: 'ep-nonexistent',
          contactId: 'contact-sess',
          agentId: 'booking',
          channelInstanceId: 'ci-sess',
        },
      );
    } catch (err) {
      threw = true;
      // VobaseError from notFound() has a 404 status code
      const status =
        (err as { status?: number }).status ??
        (err as { statusCode?: number }).statusCode;
      expect(status).toBe(404);
    }
    expect(threw).toBe(true);
  });

  it('does not insert session row when endpoint is missing', async () => {
    // M9: throws before insert — sessions table stays empty
    try {
      await createSession(
        { db, scheduler: mockScheduler },
        {
          endpointId: 'ep-missing',
          contactId: 'contact-sess',
          agentId: 'booking',
          channelInstanceId: 'ci-sess',
        },
      );
    } catch {
      // expected — notFound() thrown before insert
    }

    const all = await db.select().from(sessions);
    expect(all.length).toBe(0);
  });
});

describe('completeSession (M1 — structured logging)', () => {
  it('sets status to completed and records endedAt', async () => {
    const [sess] = await db
      .insert(sessions)
      .values({
        id: 'sess-complete',
        endpointId: 'ep-sess',
        contactId: 'contact-sess',
        agentId: 'booking',
        channelInstanceId: 'ci-sess',
        status: 'active',
      })
      .returning();

    await completeSession(db, sess.id);

    const [updated] = await db
      .select()
      .from(sessions)
      .where(eq(sessions.id, sess.id));

    expect(updated.status).toBe('completed');
    expect(updated.endedAt).not.toBeNull();
  });
});

describe('failSession (M1 — structured logging)', () => {
  it('sets status to failed with reason stored in metadata', async () => {
    const [sess] = await db
      .insert(sessions)
      .values({
        id: 'sess-fail',
        endpointId: 'ep-sess',
        contactId: 'contact-sess',
        agentId: 'booking',
        channelInstanceId: 'ci-sess',
        status: 'active',
      })
      .returning();

    await failSession(db, sess.id, 'Agent error');

    const [updated] = await db
      .select()
      .from(sessions)
      .where(eq(sessions.id, sess.id));

    expect(updated.status).toBe('failed');
    expect(updated.endedAt).not.toBeNull();
    expect((updated.metadata as Record<string, unknown>).failReason).toBe(
      'Agent error',
    );
  });
});
