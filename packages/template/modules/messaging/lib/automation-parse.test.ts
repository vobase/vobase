import { beforeEach, describe, expect, it, mock } from 'bun:test';
import { channelsTemplates, type VobaseDb } from '@vobase/core';

import { createTestDb } from '../../../lib/test-helpers';
import { contactAttributeDefinitions } from '../schema';
import { DraftRuleSchema } from './automation-parse-schema';
import { ParameterSchema } from './parameter-schema';

// ─── Mocks ─────────────────────────────────────────────────────────
// Force `hasLlmCredentials()` to return true without hitting a real API.
process.env.OPENAI_API_KEY = 'test-key-for-parse-tests';

interface GenerateObjectArgs {
  prompt: string;
  system?: string;
}

const RESTAURANT_DRAFT = {
  name: 'Weekly Tuesday lunch promo',
  type: 'recurring' as const,
  schedule: '0 11 * * 2',
  timezone: 'Asia/Singapore',
  audienceFilter: {
    roles: ['customer'] as const,
    attributes: [{ key: 'segment', value: 'lunch_crowd' }],
    excludeOptedOut: true,
  },
  steps: [
    {
      sequence: 1,
      templateSuggestion: 'lunch_promo_weekly',
      variableMapping: { '1': 'name' },
      isFinal: true,
    },
  ],
  parameters: { spendThreshold: 'medium', promoName: 'Tuesday lunch' },
  parameterSchema: {
    spendThreshold: {
      type: 'select' as const,
      label: 'Spend threshold',
      options: [
        { value: 'low', label: 'Low' },
        { value: 'medium', label: 'Medium' },
        { value: 'high', label: 'High' },
      ],
    },
    promoName: { type: 'string' as const, label: 'Promo name' },
  },
};

const CATERING_DRAFT = {
  name: 'Event reminder — 7 days before',
  type: 'date-relative' as const,
  dateAttribute: 'event_date',
  timezone: 'Asia/Singapore',
  audienceFilter: { roles: ['customer'] as const, excludeOptedOut: true },
  steps: [
    {
      sequence: 1,
      offsetDays: -7,
      sendAtTime: '09:00',
      templateSuggestion: 'event_reminder_7d',
      variableMapping: { '1': 'name', '2': 'attributes.event_date' },
      isFinal: true,
    },
  ],
  parameters: { offsetDays: -7, sendAtTime: '09:00' },
  parameterSchema: {
    offsetDays: {
      type: 'number' as const,
      label: 'Days before event',
      default: -7,
    },
    sendAtTime: {
      type: 'time' as const,
      label: 'Send time',
      default: '09:00',
    },
  },
};

const CLINIC_DRAFT = {
  name: 'Botox pre-treatment reminder',
  type: 'date-relative' as const,
  dateAttribute: 'appointment_date',
  timezone: 'Asia/Singapore',
  audienceFilter: {
    roles: ['customer'] as const,
    attributes: [{ key: 'treatment_category', value: 'botox' }],
    excludeOptedOut: true,
  },
  steps: [
    {
      sequence: 1,
      offsetDays: -2,
      sendAtTime: '09:00',
      templateSuggestion: 'pre_treatment_reminder_botox',
      variableMapping: { '1': 'name', '2': 'attributes.appointment_date' },
      isFinal: false,
    },
    {
      sequence: 2,
      delayHours: 24,
      templateSuggestion: 'pre_treatment_chaser_botox',
      variableMapping: { '1': 'name' },
      isFinal: true,
    },
  ],
  parameters: { offsetDays: -2, sendAtTime: '09:00', chaserDelayHours: 24 },
  parameterSchema: {
    offsetDays: {
      type: 'number' as const,
      label: 'Days before appointment',
      default: -2,
    },
    sendAtTime: {
      type: 'time' as const,
      label: 'Send time',
      default: '09:00',
    },
    chaserDelayHours: {
      type: 'number' as const,
      label: 'Chaser delay (hours)',
      default: 24,
      min: 1,
    },
  },
};

function pickDraft(userPrompt: string) {
  const p = userPrompt.toLowerCase();
  if (p.includes('lunch') || p.includes('restaurant')) return RESTAURANT_DRAFT;
  if (p.includes('event reminder') || p.includes('catering'))
    return CATERING_DRAFT;
  if (p.includes('botox') || p.includes('pre-treatment')) return CLINIC_DRAFT;
  throw new Error(`unexpected test prompt: ${userPrompt}`);
}

const originalAi = await import('ai');
mock.module('ai', () => ({
  ...originalAi,
  generateObject: async (args: GenerateObjectArgs) => {
    return { object: pickDraft(args.prompt) };
  },
}));

const originalProvider = await import('../../agents/mastra/lib/provider');
mock.module('../../agents/mastra/lib/provider', () => ({
  ...originalProvider,
  getChatModel: (_modelId: string) => ({ __mock: 'chat-model' }),
}));

// Dynamic import AFTER mocks are registered
const { parseRuleFromPrompt } = await import('./automation-parse');
const { buildSystemPrompt } = await import('./automation-parse-prompt');

// ─── Tests ─────────────────────────────────────────────────────────

describe('parseRuleFromPrompt — golden cases', () => {
  let db: VobaseDb;

  beforeEach(async () => {
    const result = await createTestDb({ withAutomation: true });
    db = result.db;

    // Seed attribute definitions (mirror real-world shape)
    await db.insert(contactAttributeDefinitions).values([
      { key: 'segment', label: 'Customer segment', type: 'text' },
      { key: 'spend_tier', label: 'Spend tier', type: 'text' },
      { key: 'event_date', label: 'Event date', type: 'date' },
      { key: 'appointment_date', label: 'Appointment date', type: 'date' },
      { key: 'treatment_category', label: 'Treatment category', type: 'text' },
    ]);

    const now = new Date();
    await db.insert(channelsTemplates).values([
      {
        channel: 'whatsapp',
        name: 'lunch_promo_weekly',
        language: 'en',
        category: 'MARKETING',
        status: 'approved',
        syncedAt: now,
      },
      {
        channel: 'whatsapp',
        name: 'event_reminder_7d',
        language: 'en',
        category: 'UTILITY',
        status: 'approved',
        syncedAt: now,
      },
      {
        channel: 'whatsapp',
        name: 'pre_treatment_reminder_botox',
        language: 'en',
        category: 'UTILITY',
        status: 'approved',
        syncedAt: now,
      },
      {
        channel: 'whatsapp',
        name: 'pre_treatment_chaser_botox',
        language: 'en',
        category: 'UTILITY',
        status: 'approved',
        syncedAt: now,
      },
      {
        // Non-English template — must NOT appear in default 'en' prompt
        channel: 'whatsapp',
        name: 'lunch_promo_weekly_zh',
        language: 'zh',
        category: 'MARKETING',
        status: 'approved',
        syncedAt: now,
      },
      {
        // Non-approved template — must NOT appear in prompt
        channel: 'whatsapp',
        name: 'draft_only',
        language: 'en',
        category: 'MARKETING',
        status: 'pending',
        syncedAt: now,
      },
    ]);
  });

  it('restaurant prompt → valid DraftRule with recurring schedule + parameterSchema', async () => {
    const draft = await parseRuleFromPrompt(
      'Send a weekly Tuesday 11am lunch promo to lunch_crowd contacts with spend_tier of medium or higher',
      { db },
    );

    expect(DraftRuleSchema.safeParse(draft).success).toBe(true);
    expect(draft.type).toBe('recurring');
    expect(draft.schedule).toBe('0 11 * * 2');
    expect(draft.steps).toHaveLength(1);
    expect(draft.steps[0]?.templateSuggestion).toBe('lunch_promo_weekly');
    expect(ParameterSchema.safeParse(draft.parameterSchema).success).toBe(true);
  });

  it('catering prompt → date-relative with offsetDays/sendAtTime', async () => {
    const draft = await parseRuleFromPrompt(
      'Send event reminder 7 days before each customer event_date at 9am',
      { db },
    );

    expect(DraftRuleSchema.safeParse(draft).success).toBe(true);
    expect(draft.type).toBe('date-relative');
    expect(draft.dateAttribute).toBe('event_date');
    expect(draft.steps[0]?.offsetDays).toBe(-7);
    expect(draft.steps[0]?.sendAtTime).toBe('09:00');
    expect(ParameterSchema.safeParse(draft.parameterSchema).success).toBe(true);
  });

  it('clinic prompt → date-relative with chaser step', async () => {
    const draft = await parseRuleFromPrompt(
      'Pre-treatment reminder 2 days before botox appointments at 9am, with 24-hour chaser if no reply',
      { db },
    );

    expect(DraftRuleSchema.safeParse(draft).success).toBe(true);
    expect(draft.type).toBe('date-relative');
    expect(draft.dateAttribute).toBe('appointment_date');
    expect(draft.steps).toHaveLength(2);
    expect(draft.steps[1]?.delayHours).toBe(24);
    expect(draft.steps[1]?.isFinal).toBe(true);
    expect(ParameterSchema.safeParse(draft.parameterSchema).success).toBe(true);
  });

  it('returns templateSuggestion as name, never a templateId', async () => {
    const draft = await parseRuleFromPrompt(
      'Send a weekly Tuesday 11am lunch promo',
      { db },
    );
    for (const step of draft.steps) {
      expect(typeof step.templateSuggestion).toBe('string');
      expect(step.templateSuggestion.length).toBeGreaterThan(0);
      // Ensure we're not leaking any templateId field
      expect((step as Record<string, unknown>).templateId).toBeUndefined();
    }
  });
});

describe('buildSystemPrompt', () => {
  let db: VobaseDb;

  beforeEach(async () => {
    const result = await createTestDb({ withAutomation: true });
    db = result.db;

    await db.insert(contactAttributeDefinitions).values([
      { key: 'segment', label: 'Customer segment', type: 'text' },
      { key: 'event_date', label: 'Event date', type: 'date' },
    ]);
    const now = new Date();
    await db.insert(channelsTemplates).values([
      {
        channel: 'whatsapp',
        name: 'welcome_en',
        language: 'en',
        category: 'MARKETING',
        status: 'approved',
        syncedAt: now,
      },
      {
        channel: 'whatsapp',
        name: 'welcome_zh',
        language: 'zh',
        category: 'MARKETING',
        status: 'approved',
        syncedAt: now,
      },
      {
        channel: 'whatsapp',
        name: 'not_yet_approved',
        language: 'en',
        category: 'MARKETING',
        status: 'pending',
        syncedAt: now,
      },
    ]);
  });

  it('includes live attribute keys + approved templates filtered by language', async () => {
    const prompt = await buildSystemPrompt({ db }, 'en');
    expect(prompt).toContain('`segment`');
    expect(prompt).toContain('`event_date`');
    expect(prompt).toContain('`welcome_en`');
    // Filtered out: different language
    expect(prompt).not.toContain('`welcome_zh`');
    // Filtered out: not approved
    expect(prompt).not.toContain('`not_yet_approved`');
  });

  it('lists templates per-language when multiple languages requested', async () => {
    const prompt = await buildSystemPrompt({ db }, 'en,zh');
    expect(prompt).toContain('Language: en');
    expect(prompt).toContain('Language: zh');
    expect(prompt).toContain('`welcome_en`');
    expect(prompt).toContain('`welcome_zh`');
  });
});

describe('parseRuleFromPrompt — missing credentials', () => {
  it('throws validation error when no LLM env keys present', async () => {
    const originalKeys = {
      OPENAI_API_KEY: process.env.OPENAI_API_KEY,
      ANTHROPIC_API_KEY: process.env.ANTHROPIC_API_KEY,
      GOOGLE_GENERATIVE_AI_API_KEY: process.env.GOOGLE_GENERATIVE_AI_API_KEY,
      BIFROST_API_KEY: process.env.BIFROST_API_KEY,
    };
    delete process.env.OPENAI_API_KEY;
    delete process.env.ANTHROPIC_API_KEY;
    delete process.env.GOOGLE_GENERATIVE_AI_API_KEY;
    delete process.env.BIFROST_API_KEY;

    try {
      const { db } = await createTestDb({ withAutomation: true });
      await expect(parseRuleFromPrompt('anything', { db })).rejects.toThrow();
    } finally {
      for (const [key, value] of Object.entries(originalKeys)) {
        if (value !== undefined) process.env[key] = value;
      }
    }
  });
});
