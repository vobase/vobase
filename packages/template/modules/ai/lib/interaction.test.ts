import { beforeEach, describe, expect, it } from 'bun:test';
import type { PGlite } from '@electric-sql/pglite';
import type { VobaseDb } from '@vobase/core';
import { eq } from 'drizzle-orm';

import { createTestDb } from '../../../lib/test-helpers';
import {
  channelInstances,
  channelRoutings,
  contacts,
  interactions,
} from '../schema';
import { setModuleDeps } from './deps';
import {
  createInteraction,
  failInteraction,
  resolveInteraction,
} from './interaction';

let _pglite: PGlite;
let db: VobaseDb;

const mockScheduler = {
  add: async () => ({ id: 'job-1' }),
} as never;

const mockChannels = {} as never;

const mockRealtime = {
  notify: async () => {},
} as never;

beforeEach(async () => {
  const result = await createTestDb();
  _pglite = result.pglite as unknown as PGlite;
  db = result.db;

  // Initialize module deps
  setModuleDeps({
    db,
    scheduler: mockScheduler,
    channels: mockChannels,
    realtime: mockRealtime,
  });

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

  await db.insert(channelRoutings).values({
    id: 'ep-sess',
    name: 'Web Endpoint',
    channelInstanceId: 'ci-sess',
    agentId: 'booking',
  });
});

// Singleton PGlite — never close; process exit handles cleanup

describe('createInteraction (M9 — endpoint validation)', () => {
  it('throws when channel routing does not exist', async () => {
    // M9: notFound() fires before any memory/DB insert, so no memory stub needed
    let threw = false;
    try {
      await createInteraction(
        { db, scheduler: mockScheduler, realtime: mockRealtime },
        {
          channelRoutingId: 'ep-nonexistent',
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

  it('does not insert interaction row when channel routing is missing', async () => {
    // M9: throws before insert — interactions table stays empty
    try {
      await createInteraction(
        { db, scheduler: mockScheduler, realtime: mockRealtime },
        {
          channelRoutingId: 'ep-missing',
          contactId: 'contact-sess',
          agentId: 'booking',
          channelInstanceId: 'ci-sess',
        },
      );
    } catch {
      // expected — notFound() thrown before insert
    }

    const all = await db.select().from(interactions);
    expect(all.length).toBe(0);
  });
});

describe('resolveInteraction (M1 — structured logging)', () => {
  it('sets status to resolved and records resolvedAt', async () => {
    const [conv] = await db
      .insert(interactions)
      .values({
        id: 'sess-complete',
        channelRoutingId: 'ep-sess',
        contactId: 'contact-sess',
        agentId: 'booking',
        channelInstanceId: 'ci-sess',
        status: 'active',
      })
      .returning();

    await resolveInteraction(db, conv.id);

    const [updated] = await db
      .select()
      .from(interactions)
      .where(eq(interactions.id, conv.id));

    expect(updated.status).toBe('resolved');
    expect(updated.resolvedAt).not.toBeNull();
  });
});

describe('failInteraction (M1 — structured logging)', () => {
  it('sets status to failed with reason stored in metadata', async () => {
    const [conv] = await db
      .insert(interactions)
      .values({
        id: 'sess-fail',
        channelRoutingId: 'ep-sess',
        contactId: 'contact-sess',
        agentId: 'booking',
        channelInstanceId: 'ci-sess',
        status: 'active',
      })
      .returning();

    await failInteraction(db, conv.id, 'Agent error');

    const [updated] = await db
      .select()
      .from(interactions)
      .where(eq(interactions.id, conv.id));

    expect(updated.status).toBe('failed');
    expect((updated.metadata as Record<string, unknown>).failReason).toBe(
      'Agent error',
    );
  });
});
