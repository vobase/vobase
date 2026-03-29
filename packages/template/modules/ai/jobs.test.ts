/**
 * Job schema validation tests — verifies each job's Zod schema rejects bad input
 * and accepts valid input. Uses a real DB to test conversationCleanupJob's query logic.
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

const sendDataSchema = z.object({ outboxId: z.string().min(1) });
const channelReplyDataSchema = z.object({
  conversationId: z.string().min(1),
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
const retryMemoryDataSchema = z.object({
  conversationId: z.string().min(1),
  contactId: z.string().min(1),
  agentId: z.string().min(1),
  channelInstanceId: z.string().min(1),
  channelRoutingId: z.string().min(1),
  attempt: z.number().int().min(1),
});

// ─── Tests ───────────────────────────────────────────────────────────────────

describe('sendJob schema (ai:send)', () => {
  it('accepts valid outboxId', () => {
    expect(() => sendDataSchema.parse({ outboxId: 'abc123' })).not.toThrow();
  });

  it('rejects missing outboxId', () => {
    expect(() => sendDataSchema.parse({})).toThrow();
  });

  it('rejects empty outboxId', () => {
    expect(() => sendDataSchema.parse({ outboxId: '' })).toThrow();
  });
});

describe('channelReplyJob schema (ai:channel-reply)', () => {
  it('accepts valid conversationId without inboundContent', () => {
    const result = channelReplyDataSchema.parse({ conversationId: 'sess-1' });
    expect(result.conversationId).toBe('sess-1');
    expect(result.inboundContent).toBeUndefined();
  });

  it('accepts valid conversationId with inboundContent', () => {
    const result = channelReplyDataSchema.parse({
      conversationId: 'sess-1',
      inboundContent: 'hello',
    });
    expect(result.inboundContent).toBe('hello');
  });

  it('rejects missing conversationId', () => {
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

describe('retryMemoryThreadJob schema (ai:retry-memory-thread)', () => {
  const validInput = {
    conversationId: 'sess-1',
    contactId: 'contact-1',
    agentId: 'booking',
    channelInstanceId: 'ci-wa-1',
    channelRoutingId: 'ep-1',
    attempt: 1,
  };

  it('accepts valid input', () => {
    expect(() => retryMemoryDataSchema.parse(validInput)).not.toThrow();
  });

  it('rejects attempt < 1', () => {
    expect(() =>
      retryMemoryDataSchema.parse({ ...validInput, attempt: 0 }),
    ).toThrow();
  });

  it('rejects missing contactId', () => {
    const { contactId: _, ...rest } = validInput;
    expect(() => retryMemoryDataSchema.parse(rest)).toThrow();
  });
});

// ─── conversationCleanupJob integration ──────────────────────────────────────
// Test the stale conversation query logic with a real DB (without mock.module).

import { and, eq, lt } from 'drizzle-orm';

import {
  channelInstances,
  channelRoutings,
  contacts,
  conversations,
} from './schema';

let _pglite: PGlite;
let db: VobaseDb;

beforeEach(async () => {
  const result = await createTestDb();
  _pglite = result.pglite as unknown as PGlite;
  db = result.db;
});

// Singleton PGlite — never close; process exit handles cleanup

describe('conversationCleanupJob stale-conversation query', () => {
  it('finds conversations inactive for 7+ days', async () => {
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
    await db.insert(conversations).values({
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
      .update(conversations)
      .set({ updatedAt: eightDaysAgo })
      .where(eq(conversations.id, 'sess-stale'));

    const sevenDaysAgo = new Date(Date.now() - 7 * 24 * 60 * 60 * 1000);
    const stale = await db
      .select({ id: conversations.id })
      .from(conversations)
      .where(
        and(
          eq(conversations.status, 'active'),
          lt(conversations.updatedAt, sevenDaysAgo),
        ),
      );

    expect(stale.length).toBe(1);
    expect(stale[0].id).toBe('sess-stale');
  });

  it('does not find recently-active conversations', async () => {
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
    await db.insert(conversations).values({
      id: 'sess-fresh',
      channelRoutingId: 'ep-2',
      contactId: 'contact-2',
      agentId: 'booking',
      channelInstanceId: 'ci-web-2',
      status: 'active',
    });

    const sevenDaysAgo = new Date(Date.now() - 7 * 24 * 60 * 60 * 1000);
    const stale = await db
      .select({ id: conversations.id })
      .from(conversations)
      .where(
        and(
          eq(conversations.status, 'active'),
          lt(conversations.updatedAt, sevenDaysAgo),
        ),
      );

    expect(stale.length).toBe(0);
  });
});
