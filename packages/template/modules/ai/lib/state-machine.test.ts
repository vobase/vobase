import { beforeEach, describe, expect, it } from 'bun:test';
import type { PGlite } from '@electric-sql/pglite';
import type { VobaseDb } from '@vobase/core';

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
      assignee: 'agent:booking',
      status: 'active',
      ...overrides,
    })
    .returning();
  return conv;
}

/** Insert active then transition to resolving via the state machine */
async function insertResolvingConversation(id = 'conv-sm') {
  await insertActiveConversation({ id });
  const result = await transition(deps(), id, { type: 'SET_RESOLVING' });
  if (!result.ok) throw new Error(`Failed to set resolving: ${result.error}`);
  return result.conversation;
}

// ── REASSIGN ──────────────────────────────────────────────────────────────────

describe('REASSIGN', () => {
  it('reassigns from agent to user (human takeover)', async () => {
    await insertActiveConversation({ assignee: 'agent:booking' });

    const result = await transition(deps(), 'conv-sm', {
      type: 'REASSIGN',
      assignee: 'user-1',
      reason: 'Escalated to human',
    });

    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.conversation.assignee).toBe('user-1');
  });

  it('reassigns from user back to agent', async () => {
    await insertActiveConversation({ assignee: 'user-1' });

    const result = await transition(deps(), 'conv-sm', {
      type: 'REASSIGN',
      assignee: 'agent:booking',
      reason: 'Handed back to AI',
    });

    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.conversation.assignee).toBe('agent:booking');
  });

  it('rejects when conversation is resolved', async () => {
    await insertActiveConversation();
    // Complete via state machine
    await transition(deps(), 'conv-sm', { type: 'RESOLVE' });

    const result = await transition(deps(), 'conv-sm', {
      type: 'REASSIGN',
      assignee: 'user-1',
      reason: 'Should fail',
    });

    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.code).toBe('INVALID_TRANSITION');
  });
});

// ── HOLD / UNHOLD ─────────────────────────────────────────────────────────────

describe('HOLD', () => {
  it('transitions active → onHold=true', async () => {
    await insertActiveConversation();

    const result = await transition(deps(), 'conv-sm', {
      type: 'HOLD',
      reason: 'Waiting for callback',
    });

    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.conversation.onHold).toBe(true);
    expect(result.conversation.holdReason).toBe('Waiting for callback');
  });

  it('rejects from resolved status', async () => {
    await insertActiveConversation();
    await transition(deps(), 'conv-sm', { type: 'RESOLVE' });

    const result = await transition(deps(), 'conv-sm', {
      type: 'HOLD',
      reason: 'Should fail',
    });

    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.code).toBe('INVALID_TRANSITION');
  });
});

describe('UNHOLD', () => {
  it('clears onHold and holdReason', async () => {
    await insertActiveConversation({ onHold: true, holdReason: 'Test hold' });

    const result = await transition(deps(), 'conv-sm', {
      type: 'UNHOLD',
    });

    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.conversation.onHold).toBe(false);
    expect(result.conversation.holdReason).toBeNull();
  });
});

// ── SET_RESOLVING ────────────────────────────────────────────────────────────

describe('SET_RESOLVING', () => {
  it('transitions active -> resolving', async () => {
    await insertActiveConversation();

    const result = await transition(deps(), 'conv-sm', {
      type: 'SET_RESOLVING',
    });

    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.conversation.status).toBe('resolving');
  });

  it('rejects from resolved status', async () => {
    await insertActiveConversation();
    await transition(deps(), 'conv-sm', { type: 'RESOLVE' });

    const result = await transition(deps(), 'conv-sm', {
      type: 'SET_RESOLVING',
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
      type: 'SET_RESOLVING',
    });

    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.code).toBe('INVALID_TRANSITION');
  });
});

// ── GENERATION_DONE ───────────────────────────────────────────────────────────

describe('GENERATION_DONE', () => {
  it('transitions resolving -> resolved', async () => {
    await insertResolvingConversation();

    const result = await transition(deps(), 'conv-sm', {
      type: 'GENERATION_DONE',
      outcome: 'resolved',
    });

    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.conversation.status).toBe('resolved');
    expect(result.conversation.resolvedAt).not.toBeNull();
    expect(result.conversation.outcome).toBe('resolved');
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

// ── RESOLVING_TIMEOUT ──────────────────────────────────────────────

describe('RESOLVING_TIMEOUT', () => {
  it('transitions resolving -> failed', async () => {
    await insertResolvingConversation();

    const result = await transition(deps(), 'conv-sm', {
      type: 'RESOLVING_TIMEOUT',
    });

    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.conversation.status).toBe('failed');
  });

  it('rejects from active status', async () => {
    await insertActiveConversation();

    const result = await transition(deps(), 'conv-sm', {
      type: 'RESOLVING_TIMEOUT',
    });

    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.code).toBe('INVALID_TRANSITION');
  });
});

// ── resolving blocks other events ──────────────────────────────────

describe('resolving status guards', () => {
  it('rejects REASSIGN from resolving', async () => {
    await insertResolvingConversation();

    const result = await transition(deps(), 'conv-sm', {
      type: 'REASSIGN',
      assignee: 'user-1',
      reason: 'Should fail',
    });

    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.code).toBe('INVALID_TRANSITION');
  });

  it('rejects RESOLVE from resolving', async () => {
    await insertResolvingConversation();

    const result = await transition(deps(), 'conv-sm', {
      type: 'RESOLVE',
    });

    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.code).toBe('INVALID_TRANSITION');
  });
});
