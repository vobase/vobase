import { beforeEach, describe, expect, it } from 'bun:test';
import type { PGlite } from '@electric-sql/pglite';
import type { VobaseDb } from '@vobase/core';

import { createTestDb } from '../../../lib/test-helpers';
import {
  channelInstances,
  channelRoutings,
  contacts,
  interactions,
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

async function insertActiveInteraction(
  overrides: Partial<typeof interactions.$inferInsert> = {},
) {
  const id = overrides.id ?? 'conv-sm';
  const [conv] = await db
    .insert(interactions)
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

/** Insert active then transition to resolving via the state machine */
async function insertResolvingInteraction(id = 'conv-sm') {
  await insertActiveInteraction({ id });
  const result = await transition(deps(), id, { type: 'SET_RESOLVING' });
  if (!result.ok) throw new Error(`Failed to set resolving: ${result.error}`);
  return result.interaction;
}

// ── ESCALATE_MODE ─────────────────────────────────────────────────────

describe('ESCALATE_MODE', () => {
  it('transitions ai -> supervised with priority', async () => {
    await insertActiveInteraction({ mode: 'ai' });

    const result = await transition(deps(), 'conv-sm', {
      type: 'ESCALATE_MODE',
      mode: 'supervised',
      priority: 'high',
    });

    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.interaction.mode).toBe('supervised');
    expect(result.interaction.priority).toBe('high');
  });

  it('transitions supervised -> human', async () => {
    await insertActiveInteraction({ mode: 'supervised' });

    const result = await transition(deps(), 'conv-sm', {
      type: 'ESCALATE_MODE',
      mode: 'human',
    });

    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.interaction.mode).toBe('human');
  });

  it('rejects downgrade from human', async () => {
    await insertActiveInteraction({ mode: 'human' });

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
    await insertActiveInteraction({ mode: 'supervised' });

    const result = await transition(deps(), 'conv-sm', {
      type: 'ESCALATE_MODE',
      mode: 'supervised',
    });

    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.code).toBe('GUARD_FAILED');
    expect(result.error).toContain('Already in supervised');
  });

  it('rejects when interaction is resolved', async () => {
    await insertActiveInteraction();
    // Complete via state machine
    await transition(deps(), 'conv-sm', { type: 'RESOLVE' });

    const result = await transition(deps(), 'conv-sm', {
      type: 'ESCALATE_MODE',
      mode: 'human',
    });

    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.code).toBe('INVALID_TRANSITION');
  });
});

// ── SET_RESOLVING ────────────────────────────────────────────────────

describe('SET_RESOLVING', () => {
  it('transitions active -> resolving', async () => {
    await insertActiveInteraction();

    const result = await transition(deps(), 'conv-sm', {
      type: 'SET_RESOLVING',
    });

    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.interaction.status).toBe('resolving');
  });

  it('rejects from resolved status', async () => {
    await insertActiveInteraction();
    await transition(deps(), 'conv-sm', { type: 'RESOLVE' });

    const result = await transition(deps(), 'conv-sm', {
      type: 'SET_RESOLVING',
    });

    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.code).toBe('INVALID_TRANSITION');
  });

  it('rejects from failed status', async () => {
    await insertActiveInteraction();
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

// ── GENERATION_DONE ───────────────────────────────────────────────────

describe('GENERATION_DONE', () => {
  it('transitions resolving -> resolved', async () => {
    await insertResolvingInteraction();

    const result = await transition(deps(), 'conv-sm', {
      type: 'GENERATION_DONE',
      outcome: 'resolved',
    });

    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.interaction.status).toBe('resolved');
    expect(result.interaction.resolvedAt).not.toBeNull();
    expect(result.interaction.outcome).toBe('resolved');
  });

  it('rejects from active status', async () => {
    await insertActiveInteraction();

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
    await insertResolvingInteraction();

    const result = await transition(deps(), 'conv-sm', {
      type: 'RESOLVING_TIMEOUT',
    });

    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.interaction.status).toBe('failed');
  });

  it('rejects from active status', async () => {
    await insertActiveInteraction();

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
  it('rejects SET_MODE from resolving', async () => {
    await insertResolvingInteraction();

    const result = await transition(deps(), 'conv-sm', {
      type: 'SET_MODE',
      mode: 'human',
    });

    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.code).toBe('INVALID_TRANSITION');
  });

  it('rejects COMPLETE from resolving', async () => {
    await insertResolvingInteraction();

    const result = await transition(deps(), 'conv-sm', {
      type: 'RESOLVE',
    });

    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.code).toBe('INVALID_TRANSITION');
  });
});
