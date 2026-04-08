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
} from '../schema';
import { setModuleDeps } from './deps';
import { transition } from './state-machine';

let _pglite: PGlite;
let db: VobaseDb;

const mockRealtime = {
  notify: async () => {},
} as never;

const deps = () => ({ db, realtime: mockRealtime });

beforeEach(async () => {
  const result = await createTestDb();
  _pglite = result.pglite as unknown as PGlite;
  db = result.db;

  setModuleDeps({
    db,
    scheduler: { add: async () => ({ id: 'job-1' }) } as never,
    channels: {} as never,
    realtime: mockRealtime,
  });

  await db.insert(contacts).values({
    id: 'contact-sm',
    phone: '+6591234567',
    name: 'Test Customer',
    role: 'customer',
  });

  await db.insert(channelInstances).values({
    id: 'ci-sm',
    type: 'web',
    label: 'Web Chat',
    source: 'env',
    status: 'active',
  });

  await db.insert(channelRoutings).values({
    id: 'ep-sm',
    name: 'Web Endpoint',
    channelInstanceId: 'ci-sm',
    agentId: 'booking',
  });
});

async function insertActiveConversation(
  overrides: Partial<typeof conversations.$inferInsert> = {},
) {
  const id = overrides.id ?? 'conv-sm';
  const [conv] = await db
    .insert(conversations)
    .values({
      id,
      channelRoutingId: 'ep-sm',
      contactId: 'contact-sm',
      agentId: 'booking',
      channelInstanceId: 'ci-sm',
      status: 'active',
      ...overrides,
    })
    .returning();
  return conv;
}

/** Insert active then transition to completing via the state machine */
async function insertCompletingConversation(id = 'conv-sm') {
  await insertActiveConversation({ id });
  const result = await transition(deps(), id, { type: 'SET_COMPLETING' });
  if (!result.ok) throw new Error(`Failed to set completing: ${result.error}`);
  return result.conversation;
}

// ── ESCALATE_MODE ─────────────────────────────────────────────────────

describe('ESCALATE_MODE', () => {
  it('transitions ai -> supervised with priority', async () => {
    await insertActiveConversation({ mode: 'ai' });

    const result = await transition(deps(), 'conv-sm', {
      type: 'ESCALATE_MODE',
      mode: 'supervised',
      priority: 'high',
    });

    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.conversation.mode).toBe('supervised');
    expect(result.conversation.priority).toBe('high');
  });

  it('transitions supervised -> human', async () => {
    await insertActiveConversation({ mode: 'supervised' });

    const result = await transition(deps(), 'conv-sm', {
      type: 'ESCALATE_MODE',
      mode: 'human',
    });

    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.conversation.mode).toBe('human');
  });

  it('rejects downgrade from human', async () => {
    await insertActiveConversation({ mode: 'human' });

    const result = await transition(deps(), 'conv-sm', {
      type: 'ESCALATE_MODE',
      mode: 'supervised',
    });

    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.code).toBe('GUARD_FAILED');
    expect(result.error).toContain('Cannot downgrade');
  });

  it('rejects no-op (same mode)', async () => {
    await insertActiveConversation({ mode: 'supervised' });

    const result = await transition(deps(), 'conv-sm', {
      type: 'ESCALATE_MODE',
      mode: 'supervised',
    });

    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.code).toBe('GUARD_FAILED');
    expect(result.error).toContain('Already in supervised');
  });

  it('rejects when conversation is completed', async () => {
    await insertActiveConversation();
    // Complete via state machine
    await transition(deps(), 'conv-sm', { type: 'COMPLETE' });

    const result = await transition(deps(), 'conv-sm', {
      type: 'ESCALATE_MODE',
      mode: 'human',
    });

    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.code).toBe('INVALID_TRANSITION');
  });
});

// ── SET_COMPLETING ────────────────────────────────────────────────────

describe('SET_COMPLETING', () => {
  it('transitions active -> completing', async () => {
    await insertActiveConversation();

    const result = await transition(deps(), 'conv-sm', {
      type: 'SET_COMPLETING',
    });

    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.conversation.status).toBe('completing');
  });

  it('rejects from completed status', async () => {
    await insertActiveConversation();
    await transition(deps(), 'conv-sm', { type: 'COMPLETE' });

    const result = await transition(deps(), 'conv-sm', {
      type: 'SET_COMPLETING',
    });

    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.code).toBe('INVALID_TRANSITION');
  });

  it('rejects from failed status', async () => {
    await insertActiveConversation();
    await transition(deps(), 'conv-sm', {
      type: 'FAIL',
      reason: 'test failure',
    });

    const result = await transition(deps(), 'conv-sm', {
      type: 'SET_COMPLETING',
    });

    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.code).toBe('INVALID_TRANSITION');
  });
});

// ── GENERATION_DONE ───────────────────────────────────────────────────

describe('GENERATION_DONE', () => {
  it('transitions completing -> completed', async () => {
    await insertCompletingConversation();

    const result = await transition(deps(), 'conv-sm', {
      type: 'GENERATION_DONE',
      resolutionOutcome: 'resolved',
    });

    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.conversation.status).toBe('completed');
    expect(result.conversation.endedAt).not.toBeNull();
    expect(result.conversation.resolutionOutcome).toBe('resolved');
  });

  it('rejects from active status', async () => {
    await insertActiveConversation();

    const result = await transition(deps(), 'conv-sm', {
      type: 'GENERATION_DONE',
    });

    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.code).toBe('INVALID_TRANSITION');
  });
});

// ── COMPLETING_TIMEOUT ──────────────────────────────────────────────

describe('COMPLETING_TIMEOUT', () => {
  it('transitions completing -> failed', async () => {
    await insertCompletingConversation();

    const result = await transition(deps(), 'conv-sm', {
      type: 'COMPLETING_TIMEOUT',
    });

    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.conversation.status).toBe('failed');
    expect(result.conversation.endedAt).not.toBeNull();
    expect(result.conversation.resolutionOutcome).toBe('failed');
  });

  it('rejects from active status', async () => {
    await insertActiveConversation();

    const result = await transition(deps(), 'conv-sm', {
      type: 'COMPLETING_TIMEOUT',
    });

    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.code).toBe('INVALID_TRANSITION');
  });
});

// ── completing blocks other events ──────────────────────────────────

describe('completing status guards', () => {
  it('rejects SET_MODE from completing', async () => {
    await insertCompletingConversation();

    const result = await transition(deps(), 'conv-sm', {
      type: 'SET_MODE',
      mode: 'human',
    });

    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.code).toBe('INVALID_TRANSITION');
  });

  it('rejects COMPLETE from completing', async () => {
    await insertCompletingConversation();

    const result = await transition(deps(), 'conv-sm', {
      type: 'COMPLETE',
    });

    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.code).toBe('INVALID_TRANSITION');
  });
});
