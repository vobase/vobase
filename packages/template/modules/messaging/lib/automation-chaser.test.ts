import { beforeEach, describe, expect, it } from 'bun:test';
import type { ChannelAdapter, VobaseDb } from '@vobase/core';

import { createTestDb } from '../../../lib/test-helpers';
import {
  automationExecutions,
  automationRecipients,
  automationRuleSteps,
  automationRules,
  channelInstances,
  contacts,
} from '../schema';
import { advanceChasers } from './automation-chaser';
import { setModuleDeps } from './deps';

const mockAdapter: ChannelAdapter = {
  name: 'whatsapp',
  inboundMode: 'push',
  capabilities: {
    templates: true,
    media: false,
    reactions: false,
    readReceipts: false,
    typingIndicators: false,
    streaming: false,
    messagingWindow: true,
  },
  contactIdentifierField: 'phone',
  deliveryModel: 'queued',
  async send() {
    return { success: true, messageId: 'wa-1' };
  },
};

const mockChannels = {
  on() {},
  get() {
    return undefined;
  },
  getAdapter() {
    return mockAdapter;
  },
  registerAdapter() {},
  unregisterAdapter() {},
  onProvision() {},
  async provision() {
    throw new Error('not implemented');
  },
} as never;

const schedulerJobs: Array<{
  name: string;
  data: unknown;
  opts?: unknown;
}> = [];
const mockScheduler = {
  async add(name: string, data: unknown, opts?: unknown) {
    schedulerJobs.push({ name, data, opts });
  },
  async send() {
    return null;
  },
  async schedule() {},
  async unschedule() {},
  async stop() {},
} as never;

const mockRealtime = {
  notify: async () => {},
} as never;

interface Seed {
  ruleId: string;
  executionId: string;
}

async function seedChaserScenario(db: VobaseDb): Promise<Seed> {
  await db.insert(channelInstances).values({
    id: 'ci-wa',
    type: 'whatsapp',
    label: 'WhatsApp',
    source: 'env',
  });

  const [rule] = await db
    .insert(automationRules)
    .values({
      name: 'Chaser',
      type: 'recurring',
      isActive: true,
      channelInstanceId: 'ci-wa',
      timezone: 'UTC',
      createdBy: 'user-1',
    })
    .returning({ id: automationRules.id });

  await db.insert(automationRuleSteps).values([
    {
      ruleId: rule?.id,
      sequence: 1,
      templateId: 'tpl-1',
      templateName: 'initial',
      templateLanguage: 'en',
    },
    {
      ruleId: rule?.id,
      sequence: 2,
      delayHours: 24,
      templateId: 'tpl-2',
      templateName: 'chaser',
      templateLanguage: 'en',
    },
  ]);

  const [execution] = await db
    .insert(automationExecutions)
    .values({
      ruleId: rule?.id,
      stepSequence: 1,
      status: 'running',
      totalRecipients: 1,
    })
    .returning({ id: automationExecutions.id });

  return { ruleId: rule?.id, executionId: execution?.id };
}

async function seedRecipient(
  db: VobaseDb,
  seed: Seed,
  args: {
    id: string;
    phone: string;
    contactId: string;
    status?: typeof automationRecipients.$inferInsert.status;
    nextStepAt?: Date | null;
    repliedAt?: Date | null;
    currentStep?: number;
  },
): Promise<void> {
  await db.insert(contacts).values({
    id: args.contactId,
    phone: args.phone,
    name: args.contactId,
    role: 'customer',
  });
  await db.insert(automationRecipients).values({
    id: args.id,
    executionId: seed.executionId,
    ruleId: seed.ruleId,
    contactId: args.contactId,
    phone: args.phone,
    currentStep: args.currentStep ?? 1,
    status: args.status ?? 'sent',
    nextStepAt: args.nextStepAt ?? new Date('2026-04-17T00:00:00Z'),
    repliedAt: args.repliedAt ?? null,
    sentAt: new Date('2026-04-16T00:00:00Z'),
  });
}

describe('advanceChasers — gating', () => {
  let db: VobaseDb;

  beforeEach(async () => {
    const result = await createTestDb({ withAutomation: true });
    db = result.db;
    schedulerJobs.length = 0;

    setModuleDeps({
      db,
      scheduler: mockScheduler,
      channels: mockChannels,
      realtime: mockRealtime,
    });
  });

  it('advances a sent recipient with nextStepAt in past and replied_at null', async () => {
    const seed = await seedChaserScenario(db);
    await seedRecipient(db, seed, {
      id: 'r-1',
      phone: '+6591000001',
      contactId: 'c-1',
      status: 'sent',
      nextStepAt: new Date('2026-04-16T00:00:00Z'),
    });

    const result = await advanceChasers(new Date('2026-04-17T00:00:00Z'));
    expect(result.advanced).toBe(1);

    const recipients = await db.select().from(automationRecipients);
    expect(recipients).toHaveLength(1);
    expect(recipients[0]?.status).toBe('queued');
    expect(recipients[0]?.currentStep).toBe(2);
    expect(recipients[0]?.nextStepAt).toBeNull();
    // Moved to a fresh execution row for step 2
    expect(recipients[0]?.executionId).not.toBe(seed.executionId);

    // New execution row was created for step 2
    const executions = await db.select().from(automationExecutions);
    expect(executions).toHaveLength(2);
    const newExec = executions.find((e) => e.stepSequence === 2);
    expect(newExec).toBeDefined();
    expect(newExec?.totalRecipients).toBe(1);

    // Job enqueued for the new execution + stepSequence=2
    const enqueued = schedulerJobs.filter(
      (j) => j.name === 'automation:execute-step',
    );
    expect(enqueued).toHaveLength(1);
    expect(enqueued[0]?.data).toMatchObject({ stepSequence: 2 });
  });

  it('short-circuits when replied_at is set', async () => {
    const seed = await seedChaserScenario(db);
    await seedRecipient(db, seed, {
      id: 'r-1',
      phone: '+6591000001',
      contactId: 'c-1',
      status: 'sent',
      nextStepAt: new Date('2026-04-16T00:00:00Z'),
      repliedAt: new Date('2026-04-16T12:00:00Z'),
    });

    const result = await advanceChasers(new Date('2026-04-17T00:00:00Z'));
    expect(result.advanced).toBe(0);

    const [r] = await db.select().from(automationRecipients);
    expect(r?.status).toBe('sent');
    expect(r?.currentStep).toBe(1);
  });

  it('skips recipients whose nextStepAt is in the future', async () => {
    const seed = await seedChaserScenario(db);
    await seedRecipient(db, seed, {
      id: 'r-1',
      phone: '+6591000001',
      contactId: 'c-1',
      status: 'sent',
      nextStepAt: new Date('2026-05-01T00:00:00Z'),
    });

    const result = await advanceChasers(new Date('2026-04-17T00:00:00Z'));
    expect(result.advanced).toBe(0);
  });

  it('skips recipients with no next step defined', async () => {
    const seed = await seedChaserScenario(db);
    // Remove step 2 — recipient is at currentStep=1 but no step 2 exists
    await db.delete(automationRuleSteps);
    await db.insert(automationRuleSteps).values({
      ruleId: seed.ruleId,
      sequence: 1,
      templateId: 'tpl-1',
      templateName: 'initial',
      templateLanguage: 'en',
    });

    await seedRecipient(db, seed, {
      id: 'r-1',
      phone: '+6591000001',
      contactId: 'c-1',
      status: 'sent',
      nextStepAt: new Date('2026-04-16T00:00:00Z'),
    });

    const result = await advanceChasers(new Date('2026-04-17T00:00:00Z'));
    expect(result.advanced).toBe(0);
  });

  it('skips queued and failed statuses (only sent/delivered/read advance)', async () => {
    const seed = await seedChaserScenario(db);
    await seedRecipient(db, seed, {
      id: 'r-queued',
      phone: '+6591000001',
      contactId: 'c-1',
      status: 'queued',
      nextStepAt: new Date('2026-04-16T00:00:00Z'),
    });
    await seedRecipient(db, seed, {
      id: 'r-failed',
      phone: '+6591000002',
      contactId: 'c-2',
      status: 'failed',
      nextStepAt: new Date('2026-04-16T00:00:00Z'),
    });

    const result = await advanceChasers(new Date('2026-04-17T00:00:00Z'));
    expect(result.advanced).toBe(0);
  });
});

describe('advanceChasers — concurrency', () => {
  let db: VobaseDb;

  beforeEach(async () => {
    const result = await createTestDb({ withAutomation: true });
    db = result.db;
    schedulerJobs.length = 0;

    setModuleDeps({
      db,
      scheduler: mockScheduler,
      channels: mockChannels,
      realtime: mockRealtime,
    });
  });

  it('two concurrent runs produce disjoint claims and total equals recipient count', async () => {
    const seed = await seedChaserScenario(db);

    // Seed 10 due recipients
    for (let i = 0; i < 10; i++) {
      await seedRecipient(db, seed, {
        id: `r-${i}`,
        phone: `+659100000${i}`,
        contactId: `c-${i}`,
        status: 'sent',
        nextStepAt: new Date('2026-04-16T00:00:00Z'),
      });
    }

    const now = new Date('2026-04-17T00:00:00Z');
    const [a, b] = await Promise.all([
      advanceChasers(now),
      advanceChasers(now),
    ]);

    // Combined total must equal 10; sets must be disjoint due to SKIP LOCKED
    expect(a.advanced + b.advanced).toBe(10);

    const recipients = await db.select().from(automationRecipients);
    expect(recipients.filter((r) => r.status === 'queued')).toHaveLength(10);
    expect(recipients.filter((r) => r.currentStep === 2)).toHaveLength(10);
  });
});
