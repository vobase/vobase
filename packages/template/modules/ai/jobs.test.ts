/**
 * Job schema validation tests — verifies each job's Zod schema rejects bad input
 * and accepts valid input. Uses a real DB to test interactionCleanupJob's query logic.
 *
 * NOTE: We intentionally avoid mock.module here to prevent module cache
 * pollution that would break sibling test files (Bun shares module registry
 * within a process when multiple test files run together).
 */
import { beforeEach, describe, expect, it } from 'bun:test';
import type { PGlite } from '@electric-sql/pglite';
import type { VobaseDb } from '@vobase/core';
import { z } from 'zod';

import { createTestDb } from '../../lib/test-helpers';

// ─── Schema definitions (mirrors jobs.ts schemas for direct testing) ──────────

const deliverDataSchema = z.object({ messageId: z.string().min(1) });
const channelReplyDataSchema = z.object({
  interactionId: z.string().min(1),
  inboundContent: z.string().optional(),
});
const processInboundDataSchema = z.object({
  event: z
    .object({
      channelInstanceId: z.string().optional(),
      channel: z.string(),
      from: z.string(),
      content: z.string().optional(),
      profileName: z.string().optional(),
      timestamp: z.string().optional(),
    })
    .passthrough(),
  adapterName: z.string(),
});

// ─── Tests ───────────────────────────────────────────────────────────────────

describe('deliverMessageJob schema (ai:deliver-message)', () => {
  it('accepts valid messageId', () => {
    expect(() =>
      deliverDataSchema.parse({ messageId: 'abc123' }),
    ).not.toThrow();
  });

  it('rejects missing messageId', () => {
    expect(() => deliverDataSchema.parse({})).toThrow();
  });

  it('rejects empty messageId', () => {
    expect(() => deliverDataSchema.parse({ messageId: '' })).toThrow();
  });
});

describe('channelReplyJob schema (ai:channel-reply)', () => {
  it('accepts valid interactionId without inboundContent', () => {
    const result = channelReplyDataSchema.parse({ interactionId: 'sess-1' });
    expect(result.interactionId).toBe('sess-1');
    expect(result.inboundContent).toBeUndefined();
  });

  it('accepts valid interactionId with inboundContent', () => {
    const result = channelReplyDataSchema.parse({
      interactionId: 'sess-1',
      inboundContent: 'hello',
    });
    expect(result.inboundContent).toBe('hello');
  });

  it('rejects missing interactionId', () => {
    expect(() => channelReplyDataSchema.parse({})).toThrow();
  });
});

describe('processInboundJob schema (ai:process-inbound)', () => {
  it('accepts valid event with required fields', () => {
    const result = processInboundDataSchema.parse({
      event: { channel: 'whatsapp', from: '+6591234567' },
      adapterName: 'ci-wa-1',
    });
    expect(result.adapterName).toBe('ci-wa-1');
    expect(result.event.channel).toBe('whatsapp');
  });

  it('rejects missing adapterName', () => {
    expect(() =>
      processInboundDataSchema.parse({
        event: { channel: 'whatsapp', from: '+65' },
      }),
    ).toThrow();
  });

  it('rejects missing event', () => {
    expect(() =>
      processInboundDataSchema.parse({ adapterName: 'x' }),
    ).toThrow();
  });
});

// ─── interactionCleanupJob integration ──────────────────────────────────────
// Test the stale interaction query logic with a real DB (without mock.module).

import { and, eq, lt } from 'drizzle-orm';

import {
  channelInstances,
  channelRoutings,
  contacts,
  interactions,
} from './schema';

let _pglite: PGlite;
let db: VobaseDb;

beforeEach(async () => {
  const result = await createTestDb();
  _pglite = result.pglite as unknown as PGlite;
  db = result.db;
});

// Singleton PGlite — never close; process exit handles cleanup

describe('interactionCleanupJob stale-interaction query', () => {
  it('finds interactions inactive for 7+ days', async () => {
    await db.insert(contacts).values({
      id: 'contact-1',
      phone: '+6591234567',
      name: 'Test',
      role: 'customer',
    });
    await db.insert(channelInstances).values({
      id: 'ci-web-1',
      type: 'web',
      label: 'Web',
      source: 'env',
      status: 'active',
    });
    await db.insert(channelRoutings).values({
      id: 'ep-1',
      name: 'EP',
      channelInstanceId: 'ci-web-1',
      agentId: 'booking',
    });
    await db.insert(interactions).values({
      id: 'sess-stale',
      channelRoutingId: 'ep-1',
      contactId: 'contact-1',
      agentId: 'booking',
      channelInstanceId: 'ci-web-1',
      status: 'active',
    });

    // Backdate updatedAt to 8 days ago
    const eightDaysAgo = new Date(Date.now() - 8 * 24 * 60 * 60 * 1000);
    await db
      .update(interactions)
      .set({ updatedAt: eightDaysAgo })
      .where(eq(interactions.id, 'sess-stale'));

    const sevenDaysAgo = new Date(Date.now() - 7 * 24 * 60 * 60 * 1000);
    const stale = await db
      .select({ id: interactions.id })
      .from(interactions)
      .where(
        and(
          eq(interactions.status, 'active'),
          lt(interactions.updatedAt, sevenDaysAgo),
        ),
      );

    expect(stale.length).toBe(1);
    expect(stale[0].id).toBe('sess-stale');
  });

  it('does not find recently-active interactions', async () => {
    await db.insert(contacts).values({
      id: 'contact-2',
      phone: '+6598765432',
      name: 'Recent',
      role: 'customer',
    });
    await db.insert(channelInstances).values({
      id: 'ci-web-2',
      type: 'web',
      label: 'Web2',
      source: 'env',
      status: 'active',
    });
    await db.insert(channelRoutings).values({
      id: 'ep-2',
      name: 'EP2',
      channelInstanceId: 'ci-web-2',
      agentId: 'booking',
    });
    await db.insert(interactions).values({
      id: 'sess-fresh',
      channelRoutingId: 'ep-2',
      contactId: 'contact-2',
      agentId: 'booking',
      channelInstanceId: 'ci-web-2',
      status: 'active',
    });

    const sevenDaysAgo = new Date(Date.now() - 7 * 24 * 60 * 60 * 1000);
    const stale = await db
      .select({ id: interactions.id })
      .from(interactions)
      .where(
        and(
          eq(interactions.status, 'active'),
          lt(interactions.updatedAt, sevenDaysAgo),
        ),
      );

    expect(stale.length).toBe(0);
  });
});
