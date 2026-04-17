import { beforeEach, describe, expect, it } from 'bun:test';
import type { ChannelAdapter, VobaseDb } from '@vobase/core';
import { eq } from 'drizzle-orm';

import { createTestDb } from '../../../lib/test-helpers';
import {
  automationExecutions,
  automationRecipients,
  automationRuleSteps,
  automationRules,
  channelInstances,
  contacts,
} from '../schema';
import {
  computeNextFireAt,
  evaluateDateRelativeRules,
  evaluateRecurringRules,
} from './automation-engine';
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

async function seedRule(
  db: VobaseDb,
  overrides: Partial<typeof automationRules.$inferInsert> = {},
): Promise<string> {
  await db.insert(channelInstances).values({
    id: 'ci-wa',
    type: 'whatsapp',
    label: 'WhatsApp',
    source: 'env',
  });
  const [rule] = await db
    .insert(automationRules)
    .values({
      name: 'Test Rule',
      type: 'recurring',
      isActive: true,
      audienceFilter: { excludeOptedOut: true },
      channelInstanceId: 'ci-wa',
      timezone: 'Asia/Singapore',
      createdBy: 'user-1',
      ...overrides,
    })
    .returning({ id: automationRules.id });
  return rule?.id;
}

describe('computeNextFireAt', () => {
  it('returns next cron boundary in UTC', () => {
    // 2026-04-17 08:00:00 UTC = 2026-04-17 16:00 SGT
    const from = new Date('2026-04-17T08:00:00Z');
    // Fires at 09:00 SGT daily = 01:00 UTC
    const next = computeNextFireAt('0 9 * * *', 'Asia/Singapore', from);
    expect(next).not.toBeNull();
    // Next 09:00 SGT after 16:00 SGT is tomorrow 09:00 SGT = 01:00 UTC next day
    expect(next?.toISOString()).toBe('2026-04-18T01:00:00.000Z');
  });

  it('returns null on invalid cron', () => {
    expect(computeNextFireAt('not-a-cron', 'UTC', new Date())).toBeNull();
  });
});

describe('evaluateRecurringRules', () => {
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

  it('fires rule when nextFireAt is due, enqueues execute-step, advances cursor', async () => {
    const ruleId = await seedRule(db, {
      schedule: '0 9 * * *',
      nextFireAt: new Date('2026-04-17T00:00:00Z'),
    });

    await db.insert(automationRuleSteps).values({
      ruleId,
      sequence: 1,
      templateId: 'tpl-1',
      templateName: 'welcome',
      templateLanguage: 'en',
      variableMapping: { '1': 'name' },
    });

    await db.insert(contacts).values([
      { id: 'c-1', phone: '+6591000001', name: 'Alice', role: 'customer' },
      { id: 'c-2', phone: '+6591000002', name: 'Bob', role: 'customer' },
    ]);

    const now = new Date('2026-04-17T02:00:00Z');
    const result = await evaluateRecurringRules(now);

    expect(result.rulesFired).toBe(1);
    expect(result.recipientsInserted).toBe(2);

    const execs = await db.select().from(automationExecutions);
    expect(execs).toHaveLength(1);
    expect(execs[0]?.status).toBe('running');

    const recipients = await db.select().from(automationRecipients);
    expect(recipients).toHaveLength(2);
    expect(recipients.every((r) => r.status === 'queued')).toBe(true);
    expect(recipients.map((r) => r.phone).sort()).toEqual([
      '+6591000001',
      '+6591000002',
    ]);

    const enqueued = schedulerJobs.filter(
      (j) => j.name === 'automation:execute-step',
    );
    expect(enqueued).toHaveLength(1);

    // Cursor advanced past `now`
    const [rule] = await db
      .select()
      .from(automationRules)
      .where(eq(automationRules.id, ruleId));
    expect(rule?.nextFireAt).not.toBeNull();
    expect(rule?.nextFireAt?.getTime()).toBeGreaterThan(now.getTime());
  });

  it('skips inactive rules', async () => {
    const ruleId = await seedRule(db, {
      schedule: '0 9 * * *',
      isActive: false,
      nextFireAt: new Date('2026-04-17T00:00:00Z'),
    });
    await db.insert(automationRuleSteps).values({
      ruleId,
      sequence: 1,
      templateId: 'tpl-1',
      templateName: 'welcome',
      templateLanguage: 'en',
    });

    const result = await evaluateRecurringRules(
      new Date('2026-04-17T02:00:00Z'),
    );
    expect(result.rulesFired).toBe(0);
  });

  it('renders variables from contact name/phone/attributes', async () => {
    const ruleId = await seedRule(db, {
      schedule: '0 9 * * *',
      nextFireAt: new Date('2026-04-17T00:00:00Z'),
    });
    await db.insert(automationRuleSteps).values({
      ruleId,
      sequence: 1,
      templateId: 'tpl-1',
      templateName: 'welcome',
      templateLanguage: 'en',
      variableMapping: { '1': 'name', '2': 'attributes.plan' },
    });

    await db.insert(contacts).values({
      id: 'c-1',
      phone: '+6591000001',
      name: 'Alice',
      role: 'customer',
      attributes: { plan: 'pro' },
    });

    await evaluateRecurringRules(new Date('2026-04-17T02:00:00Z'));

    const [recipient] = await db.select().from(automationRecipients);
    expect(recipient?.variables).toEqual({ '1': 'Alice', '2': 'pro' });
  });
});

describe('evaluateDateRelativeRules', () => {
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

  it('dateValue equals today-in-rule-tz, not UTC', async () => {
    const ruleId = await seedRule(db, {
      type: 'date-relative',
      dateAttribute: 'birthday',
      timezone: 'Asia/Singapore',
    });
    await db.insert(automationRuleSteps).values({
      ruleId,
      sequence: 1,
      offsetDays: 0,
      templateId: 'tpl-1',
      templateName: 'birthday',
      templateLanguage: 'en',
    });

    // 2026-04-17 00:30 SGT is 2026-04-16 16:30 UTC — the UTC date is the 16th,
    // but the SGT (rule tz) date is the 17th. dateValue must record 2026-04-17.
    await db.insert(contacts).values({
      id: 'c-1',
      phone: '+6591000001',
      name: 'Alice',
      role: 'customer',
      attributes: { birthday: '2026-04-17' },
    });

    const now = new Date('2026-04-16T16:30:00Z');
    const result = await evaluateDateRelativeRules(now);

    expect(result.rulesFired).toBe(1);
    expect(result.recipientsInserted).toBe(1);

    const [recipient] = await db.select().from(automationRecipients);
    // date columns come back as 'YYYY-MM-DD' string in drizzle-pg
    const dateValue = recipient?.dateValue;
    expect(
      typeof dateValue === 'string'
        ? dateValue
        : (dateValue as unknown as Date).toISOString().slice(0, 10),
    ).toBe('2026-04-17');
  });

  it('offsetDays matches contact whose date attr is offsetDays ahead of today', async () => {
    const ruleId = await seedRule(db, {
      type: 'date-relative',
      dateAttribute: 'appointment',
      timezone: 'Asia/Singapore',
    });
    // 3-day reminder — fires when appointment is 3 days in the future.
    // Engine matches when (attr + offset) === today-in-tz, so a "3 days
    // before" reminder uses offsetDays = -3 (attr is 3 days ahead of today).
    await db.insert(automationRuleSteps).values({
      ruleId,
      sequence: 1,
      offsetDays: -3,
      templateId: 'tpl-1',
      templateName: 'reminder',
      templateLanguage: 'en',
    });

    await db.insert(contacts).values([
      {
        id: 'c-match',
        phone: '+6591000001',
        name: 'Alice',
        role: 'customer',
        attributes: { appointment: '2026-04-20' },
      },
      {
        id: 'c-miss',
        phone: '+6591000002',
        name: 'Bob',
        role: 'customer',
        attributes: { appointment: '2026-04-25' },
      },
    ]);

    // 2026-04-17 in SGT (12:00 local = 04:00 UTC). Target event = today + 3 = 2026-04-20.
    const now = new Date('2026-04-17T04:00:00Z');
    const result = await evaluateDateRelativeRules(now);
    expect(result.recipientsInserted).toBe(1);

    const recipients = await db.select().from(automationRecipients);
    expect(recipients.map((r) => r.contactId)).toEqual(['c-match']);
  });

  it('respects sendAtTime HH:MM match', async () => {
    const ruleId = await seedRule(db, {
      type: 'date-relative',
      dateAttribute: 'birthday',
      timezone: 'Asia/Singapore',
    });
    await db.insert(automationRuleSteps).values({
      ruleId,
      sequence: 1,
      offsetDays: 0,
      sendAtTime: '09:00',
      templateId: 'tpl-1',
      templateName: 'birthday',
      templateLanguage: 'en',
    });

    await db.insert(contacts).values({
      id: 'c-1',
      phone: '+6591000001',
      name: 'Alice',
      role: 'customer',
      attributes: { birthday: '2026-04-17' },
    });

    // 2026-04-17 08:00 SGT — sendAtTime mismatch
    const early = await evaluateDateRelativeRules(
      new Date('2026-04-17T00:00:00Z'),
    );
    expect(early.recipientsInserted).toBe(0);

    // 2026-04-17 09:00 SGT = 01:00 UTC — matches
    const onTime = await evaluateDateRelativeRules(
      new Date('2026-04-17T01:00:00Z'),
    );
    expect(onTime.recipientsInserted).toBe(1);
  });

  it('does not duplicate on second run same day (ON CONFLICT dedup)', async () => {
    const ruleId = await seedRule(db, {
      type: 'date-relative',
      dateAttribute: 'birthday',
      timezone: 'Asia/Singapore',
    });
    await db.insert(automationRuleSteps).values({
      ruleId,
      sequence: 1,
      offsetDays: 0,
      templateId: 'tpl-1',
      templateName: 'birthday',
      templateLanguage: 'en',
    });

    await db.insert(contacts).values({
      id: 'c-1',
      phone: '+6591000001',
      name: 'Alice',
      role: 'customer',
      attributes: { birthday: '2026-04-17' },
    });

    const now = new Date('2026-04-17T04:00:00Z');
    const first = await evaluateDateRelativeRules(now);
    expect(first.recipientsInserted).toBe(1);

    const second = await evaluateDateRelativeRules(now);
    expect(second.recipientsInserted).toBe(0);

    const recipients = await db.select().from(automationRecipients);
    expect(recipients).toHaveLength(1);
  });
});
