import { beforeEach, describe, expect, it } from 'bun:test';
import type { ChannelAdapter, ModuleInitContext, VobaseDb } from '@vobase/core';

import { createTestDb } from '../../../lib/test-helpers';
import {
  automationRecipients,
  automationRuleSteps,
  automationRules,
  channelInstances,
  contacts,
} from '../schema';
import {
  __resetAudienceResolvers,
  getAudienceResolver,
  registerAudienceResolver,
  setResolverContext,
} from './audience-resolvers';
import { evaluateRecurringRules } from './automation-engine';
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

const mockScheduler = {
  async add() {},
  async send() {
    return null;
  },
  async schedule() {},
  async unschedule() {},
  async stop() {},
} as never;

const mockRealtime = { notify: async () => {} } as never;

function mockCtx(db: VobaseDb): ModuleInitContext {
  return {
    db,
    scheduler: mockScheduler,
    channels: mockChannels,
    realtime: mockRealtime,
    storage: {} as never,
    http: {} as never,
    integrations: {} as never,
    auth: {} as never,
  };
}

describe('audience-resolvers registry', () => {
  beforeEach(() => {
    __resetAudienceResolvers();
  });

  it('registers and retrieves a resolver by name', () => {
    const fn = async () => [];
    registerAudienceResolver('vip-weekly', fn);
    expect(getAudienceResolver('vip-weekly')).toBe(fn);
  });

  it('throws when registering the same name twice', () => {
    registerAudienceResolver('dup', async () => []);
    expect(() => registerAudienceResolver('dup', async () => [])).toThrow(
      /already registered/,
    );
  });

  it('returns undefined for unknown resolver name', () => {
    expect(getAudienceResolver('missing')).toBeUndefined();
  });
});

describe('audience-resolvers engine integration', () => {
  let db: VobaseDb;

  beforeEach(async () => {
    const result = await createTestDb({ withAutomation: true });
    db = result.db;
    __resetAudienceResolvers();
    setModuleDeps({
      db,
      scheduler: mockScheduler,
      channels: mockChannels,
      realtime: mockRealtime,
    });
    setResolverContext(mockCtx(db));
  });

  async function seedBaseRule(
    overrides: Partial<typeof automationRules.$inferInsert> = {},
  ) {
    await db.insert(channelInstances).values({
      id: 'ci-wa',
      type: 'whatsapp',
      label: 'WhatsApp',
      source: 'env',
    });
    const [rule] = await db
      .insert(automationRules)
      .values({
        name: 'VIP Weekly',
        type: 'recurring',
        isActive: true,
        audienceFilter: { excludeOptedOut: true },
        channelInstanceId: 'ci-wa',
        timezone: 'Asia/Singapore',
        createdBy: 'user-1',
        schedule: '0 9 * * *',
        nextFireAt: new Date('2026-04-17T00:00:00Z'),
        parameters: { tier: 'gold' },
        ...overrides,
      })
      .returning({ id: automationRules.id });
    if (!rule) throw new Error('failed to seed rule');
    await db.insert(automationRuleSteps).values({
      ruleId: rule.id,
      sequence: 1,
      templateId: 'tpl-1',
      templateName: 'vip_thankyou',
      templateLanguage: 'en',
      variableMapping: { '1': 'name' },
    });
    return rule.id;
  }

  it('uses resolver when audienceResolverName is set, bypassing attribute filter', async () => {
    await seedBaseRule({ audienceResolverName: 'vip-weekly' });
    // Seed contacts: Alice qualifies via resolver; Bob + Carol match the
    // attribute filter but the resolver returns only Alice.
    await db.insert(contacts).values([
      { id: 'c-alice', phone: '+6591000001', name: 'Alice', role: 'customer' },
      { id: 'c-bob', phone: '+6591000002', name: 'Bob', role: 'customer' },
      { id: 'c-carol', phone: '+6591000003', name: 'Carol', role: 'customer' },
    ]);

    let capturedParams: unknown;
    let capturedCtxDb: VobaseDb | undefined;
    registerAudienceResolver('vip-weekly', async (ctx, params) => {
      capturedParams = params;
      capturedCtxDb = ctx.db;
      return [{ contactId: 'c-alice' }];
    });

    const result = await evaluateRecurringRules(
      new Date('2026-04-17T02:00:00Z'),
    );

    expect(result.rulesFired).toBe(1);
    expect(result.recipientsInserted).toBe(1);
    expect(capturedParams).toEqual({ tier: 'gold' });
    expect(capturedCtxDb).toBe(db);

    const recipients = await db.select().from(automationRecipients);
    expect(recipients).toHaveLength(1);
    expect(recipients[0]?.contactId).toBe('c-alice');
  });

  it('merges resolver-returned variables into automationRecipients.variables', async () => {
    await seedBaseRule({ audienceResolverName: 'vip-with-vars' });
    await db.insert(contacts).values({
      id: 'c-alice',
      phone: '+6591000001',
      name: 'Alice',
      role: 'customer',
    });

    registerAudienceResolver('vip-with-vars', async () => [
      {
        contactId: 'c-alice',
        variables: { '2': 'Gold member', loyaltyPoints: 1250 },
      },
    ]);

    await evaluateRecurringRules(new Date('2026-04-17T02:00:00Z'));

    const [recipient] = await db.select().from(automationRecipients);
    expect(recipient?.variables).toEqual({
      '1': 'Alice',
      '2': 'Gold member',
      loyaltyPoints: 1250,
    });
  });

  it('resolver values take precedence over mapped variables on key collision', async () => {
    await seedBaseRule({ audienceResolverName: 'vip-override' });
    await db.insert(contacts).values({
      id: 'c-alice',
      phone: '+6591000001',
      name: 'Alice',
      role: 'customer',
    });

    registerAudienceResolver('vip-override', async () => [
      { contactId: 'c-alice', variables: { '1': 'VIP Alice' } },
    ]);

    await evaluateRecurringRules(new Date('2026-04-17T02:00:00Z'));

    const [recipient] = await db.select().from(automationRecipients);
    expect(recipient?.variables).toEqual({ '1': 'VIP Alice' });
  });

  it('throws a clear error when audienceResolverName references an unregistered resolver', async () => {
    await seedBaseRule({ audienceResolverName: 'does-not-exist' });
    await db.insert(contacts).values({
      id: 'c-alice',
      phone: '+6591000001',
      name: 'Alice',
      role: 'customer',
    });

    await expect(
      evaluateRecurringRules(new Date('2026-04-17T02:00:00Z')),
    ).rejects.toThrow(/Unknown audience resolver: does-not-exist/);
  });

  it('falls back to attribute-filter path when audienceResolverName is unset', async () => {
    await seedBaseRule(); // no audienceResolverName
    await db.insert(contacts).values([
      { id: 'c-a', phone: '+6591000001', name: 'A', role: 'customer' },
      { id: 'c-b', phone: '+6591000002', name: 'B', role: 'customer' },
    ]);

    const result = await evaluateRecurringRules(
      new Date('2026-04-17T02:00:00Z'),
    );

    expect(result.recipientsInserted).toBe(2);
  });
});
