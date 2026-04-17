import {
  getCtx,
  notFound,
  requireRole,
  unauthorized,
  validation,
} from '@vobase/core';
import { and, count, desc, eq, gte, inArray, lte } from 'drizzle-orm';
import { Hono } from 'hono';
import { z } from 'zod';

import {
  type AudienceFilter,
  audienceFilterSchema,
  buildAudienceConditions,
} from '../lib/audience-filter';
import { parseRuleFromPrompt } from '../lib/automation-parse';
import {
  ParameterSchema,
  type ParameterSchemaT,
} from '../lib/parameter-schema';
import {
  automationExecutions,
  automationRecipients,
  automationRuleSteps,
  automationRules,
  contactLabels,
  contacts,
} from '../schema';

// ─── Schemas ────────────────────────────────────────────────────────

const listQuerySchema = z.object({
  limit: z.coerce.number().int().min(1).max(200).default(20),
  offset: z.coerce.number().int().min(0).default(0),
});

const paginationQuerySchema = z.object({
  limit: z.coerce.number().int().min(1).max(200).default(20),
  offset: z.coerce.number().int().min(0).default(0),
  status: z.enum(['running', 'completed', 'failed']).optional(),
  date_from: z.string().datetime({ offset: true }).optional(),
  date_to: z.string().datetime({ offset: true }).optional(),
});

const recipientsQuerySchema = z.object({
  limit: z.coerce.number().int().min(1).max(200).default(50),
  offset: z.coerce.number().int().min(0).default(0),
  status: z
    .enum([
      'queued',
      'sent',
      'delivered',
      'read',
      'failed',
      'skipped',
      'replied',
      'chaser_paused',
    ])
    .optional(),
});

const stepInputSchema = z.object({
  sequence: z.number().int().min(1),
  offsetDays: z.number().int().optional(),
  sendAtTime: z
    .string()
    .regex(/^([0-1][0-9]|2[0-3]):[0-5][0-9]$/)
    .optional(),
  delayHours: z.number().int().optional(),
  templateId: z.string().min(1),
  templateName: z.string().min(1),
  templateLanguage: z.string().optional().default('en'),
  variableMapping: z.record(z.string(), z.string()).optional().default({}),
  isFinal: z.boolean().optional().default(false),
});

const parseSchema = z.object({
  prompt: z.string().min(1),
  language: z.string().optional(),
});

const createSchema = z.object({
  name: z.string().min(1),
  description: z.string().optional(),
  type: z.enum(['recurring', 'date-relative']),
  channelInstanceId: z.string().min(1),
  audienceFilter: audienceFilterSchema.optional(),
  audienceResolverName: z.string().optional(),
  schedule: z.string().optional(),
  dateAttribute: z.string().optional(),
  timezone: z.string().optional(),
  parameters: z.record(z.string(), z.unknown()).optional(),
  parameterSchema: ParameterSchema.optional(),
  steps: z.array(stepInputSchema).optional(),
});

const patchSchema = z.object({
  name: z.string().min(1).optional(),
  description: z.string().optional(),
  isActive: z.boolean().optional(),
  parameters: z.record(z.string(), z.unknown()).optional(),
  audienceFilter: audienceFilterSchema.optional(),
});

const patchStepsSchema = z.object({
  steps: z.array(stepInputSchema).min(1),
});

// ─── Helpers ────────────────────────────────────────────────────────

function buildFullAudienceWhere(
  db: ReturnType<typeof getCtx>['db'],
  filter: AudienceFilter,
) {
  const where = buildAudienceConditions(filter);
  let labelCondition: ReturnType<typeof inArray> | undefined;
  if (filter.labelIds && filter.labelIds.length > 0) {
    const sub = db
      .selectDistinct({ contactId: contactLabels.contactId })
      .from(contactLabels)
      .where(inArray(contactLabels.labelId, filter.labelIds));
    labelCondition = inArray(contacts.id, sub);
  }
  if (where && labelCondition) return and(where, labelCondition);
  return labelCondition ?? where;
}

function validateParameterValues(
  parameters: Record<string, unknown>,
  schema: ParameterSchemaT,
) {
  for (const [key, value] of Object.entries(parameters)) {
    const entry = schema[key];
    if (!entry) {
      throw validation({ parameters: `unknown key: ${key}` });
    }
    if (entry.type === 'number') {
      const num = Number(value);
      if (Number.isNaN(num)) {
        throw validation({ parameters: `${key}: expected number` });
      }
      if (entry.min !== undefined && num < entry.min) {
        throw validation({
          parameters: `${key}: value ${num} is below minimum ${entry.min}`,
        });
      }
      if (entry.max !== undefined && num > entry.max) {
        throw validation({
          parameters: `${key}: value ${num} exceeds maximum ${entry.max}`,
        });
      }
    }
  }
}

// ─── Handlers ───────────────────────────────────────────────────────

export const automationHandlers = new Hono()
  .use('*', requireRole('admin'))
  // GET /rules — list with pagination
  .get('/rules', async (c) => {
    const { db, user } = getCtx(c);
    if (!user) throw unauthorized();

    const parsed = listQuerySchema.safeParse({
      limit: c.req.query('limit'),
      offset: c.req.query('offset'),
    });
    if (!parsed.success) throw validation(parsed.error.flatten().fieldErrors);
    const { limit, offset } = parsed.data;

    const [rows, [{ total }]] = await Promise.all([
      db
        .select()
        .from(automationRules)
        .orderBy(desc(automationRules.createdAt))
        .limit(limit)
        .offset(offset),
      db.select({ total: count() }).from(automationRules),
    ]);

    return c.json({ data: rows, total });
  })
  // GET /rules/:id — detail including steps and recent executions
  .get('/rules/:id', async (c) => {
    const { db, user } = getCtx(c);
    if (!user) throw unauthorized();

    const id = c.req.param('id');

    const [rule, steps, recentExecutions] = await Promise.all([
      db
        .select()
        .from(automationRules)
        .where(eq(automationRules.id, id))
        .then((r) => r[0]),
      db
        .select()
        .from(automationRuleSteps)
        .where(eq(automationRuleSteps.ruleId, id))
        .orderBy(automationRuleSteps.sequence),
      db
        .select()
        .from(automationExecutions)
        .where(eq(automationExecutions.ruleId, id))
        .orderBy(desc(automationExecutions.firedAt))
        .limit(5),
    ]);

    if (!rule) throw notFound('Automation rule not found');

    return c.json({ ...rule, steps, recentExecutions });
  })
  // GET /rules/:id/executions — paginated execution history
  .get('/rules/:id/executions', async (c) => {
    const { db, user } = getCtx(c);
    if (!user) throw unauthorized();

    const id = c.req.param('id');

    const parsed = paginationQuerySchema.safeParse({
      limit: c.req.query('limit'),
      offset: c.req.query('offset'),
      status: c.req.query('status'),
      date_from: c.req.query('date_from'),
      date_to: c.req.query('date_to'),
    });
    if (!parsed.success) throw validation(parsed.error.flatten().fieldErrors);
    const { limit, offset, status, date_from, date_to } = parsed.data;

    const [rule] = await db
      .select({ id: automationRules.id })
      .from(automationRules)
      .where(eq(automationRules.id, id));

    if (!rule) throw notFound('Automation rule not found');

    const conditions = [
      eq(automationExecutions.ruleId, id),
      ...(status ? [eq(automationExecutions.status, status)] : []),
      ...(date_from
        ? [gte(automationExecutions.firedAt, new Date(date_from))]
        : []),
      ...(date_to
        ? [lte(automationExecutions.firedAt, new Date(date_to))]
        : []),
    ];
    const condition = and(...conditions);

    const [rows, [{ total }]] = await Promise.all([
      db
        .select()
        .from(automationExecutions)
        .where(condition)
        .orderBy(desc(automationExecutions.firedAt))
        .limit(limit)
        .offset(offset),
      db.select({ total: count() }).from(automationExecutions).where(condition),
    ]);

    return c.json({ data: rows, total });
  })
  // GET /executions/:id/recipients — paginated recipient list for an execution
  .get('/executions/:id/recipients', async (c) => {
    const { db, user } = getCtx(c);
    if (!user) throw unauthorized();

    const id = c.req.param('id');

    const parsed = recipientsQuerySchema.safeParse({
      limit: c.req.query('limit'),
      offset: c.req.query('offset'),
      status: c.req.query('status'),
    });
    if (!parsed.success) throw validation(parsed.error.flatten().fieldErrors);
    const { limit, offset, status } = parsed.data;

    const [execution] = await db
      .select({ id: automationExecutions.id })
      .from(automationExecutions)
      .where(eq(automationExecutions.id, id));

    if (!execution) throw notFound('Execution not found');

    const condition = status
      ? and(
          eq(automationRecipients.executionId, id),
          eq(automationRecipients.status, status),
        )
      : eq(automationRecipients.executionId, id);

    const [rows, [{ total }]] = await Promise.all([
      db
        .select()
        .from(automationRecipients)
        .where(condition)
        .orderBy(desc(automationRecipients.createdAt))
        .limit(limit)
        .offset(offset),
      db.select({ total: count() }).from(automationRecipients).where(condition),
    ]);

    return c.json({ data: rows, total });
  })
  // POST /rules/parse — LLM parse prompt into a DraftRule
  .post('/rules/parse', async (c) => {
    const { db, user } = getCtx(c);
    if (!user) throw unauthorized();

    const body = await c.req.json();
    const parsed = parseSchema.safeParse(body);
    if (!parsed.success) throw validation(parsed.error.flatten().fieldErrors);

    const draft = await parseRuleFromPrompt(
      parsed.data.prompt,
      { db },
      parsed.data.language ?? 'en',
    );

    return c.json({ draft });
  })
  // POST /rules — create rule (optionally with initial steps)
  .post('/rules', async (c) => {
    const { db, user } = getCtx(c);
    if (!user) throw unauthorized();

    const body = await c.req.json();
    const parsed = createSchema.safeParse(body);
    if (!parsed.success) throw validation(parsed.error.flatten().fieldErrors);
    const data = parsed.data;

    const [row] = await db
      .insert(automationRules)
      .values({
        name: data.name,
        description: data.description,
        type: data.type,
        channelInstanceId: data.channelInstanceId,
        audienceFilter: data.audienceFilter ?? {},
        audienceResolverName: data.audienceResolverName,
        schedule: data.schedule,
        dateAttribute: data.dateAttribute,
        timezone: data.timezone ?? 'UTC',
        parameters: data.parameters ?? {},
        parameterSchema: data.parameterSchema ?? {},
        createdBy: user.id,
      })
      .returning();

    if (data.steps && data.steps.length > 0) {
      await db.insert(automationRuleSteps).values(
        data.steps.map((s) => ({
          ruleId: row.id,
          sequence: s.sequence,
          offsetDays: s.offsetDays,
          sendAtTime: s.sendAtTime,
          delayHours: s.delayHours,
          templateId: s.templateId,
          templateName: s.templateName,
          templateLanguage: s.templateLanguage,
          variableMapping: s.variableMapping,
          isFinal: s.isFinal,
        })),
      );
    }

    return c.json(row, 201);
  })
  // PATCH /rules/:id — update name/description/isActive/parameters/audienceFilter
  .patch('/rules/:id', async (c) => {
    const { db, user } = getCtx(c);
    if (!user) throw unauthorized();

    const id = c.req.param('id');

    const body = await c.req.json();
    const parsed = patchSchema.safeParse(body);
    if (!parsed.success) throw validation(parsed.error.flatten().fieldErrors);
    const data = parsed.data;

    const [existing] = await db
      .select({
        id: automationRules.id,
        parameterSchema: automationRules.parameterSchema,
      })
      .from(automationRules)
      .where(eq(automationRules.id, id));

    if (!existing) throw notFound('Automation rule not found');

    if (data.parameters) {
      validateParameterValues(data.parameters, existing.parameterSchema ?? {});
    }

    const [row] = await db
      .update(automationRules)
      .set({
        ...(data.name !== undefined && { name: data.name }),
        ...(data.description !== undefined && {
          description: data.description,
        }),
        ...(data.isActive !== undefined && { isActive: data.isActive }),
        ...(data.parameters !== undefined && { parameters: data.parameters }),
        ...(data.audienceFilter !== undefined && {
          audienceFilter: data.audienceFilter,
        }),
        updatedAt: new Date(),
      })
      .where(eq(automationRules.id, id))
      .returning();

    return c.json(row);
  })
  // PATCH /rules/:id/steps — replace step array transactionally
  .patch('/rules/:id/steps', async (c) => {
    const { db, user } = getCtx(c);
    if (!user) throw unauthorized();

    const id = c.req.param('id');

    const body = await c.req.json();
    const parsed = patchStepsSchema.safeParse(body);
    if (!parsed.success) throw validation(parsed.error.flatten().fieldErrors);
    const { steps } = parsed.data;

    const [existing] = await db
      .select({ id: automationRules.id })
      .from(automationRules)
      .where(eq(automationRules.id, id));

    if (!existing) throw notFound('Automation rule not found');

    const newSteps = await db.transaction(async (tx) => {
      await tx
        .delete(automationRuleSteps)
        .where(eq(automationRuleSteps.ruleId, id));

      return tx
        .insert(automationRuleSteps)
        .values(
          steps.map((s) => ({
            ruleId: id,
            sequence: s.sequence,
            offsetDays: s.offsetDays,
            sendAtTime: s.sendAtTime,
            delayHours: s.delayHours,
            templateId: s.templateId,
            templateName: s.templateName,
            templateLanguage: s.templateLanguage,
            variableMapping: s.variableMapping,
            isFinal: s.isFinal,
          })),
        )
        .returning();
    });

    return c.json({ steps: newSteps });
  })
  // POST /rules/:id/pause — set isActive=false (idempotent)
  .post('/rules/:id/pause', async (c) => {
    const { db, user } = getCtx(c);
    if (!user) throw unauthorized();

    const id = c.req.param('id');

    const [existing] = await db
      .select({ id: automationRules.id })
      .from(automationRules)
      .where(eq(automationRules.id, id));

    if (!existing) throw notFound('Automation rule not found');

    await db
      .update(automationRules)
      .set({ isActive: false, updatedAt: new Date() })
      .where(eq(automationRules.id, id));

    return c.json({ ok: true });
  })
  // POST /rules/:id/resume — set isActive=true; clear nextFireAt for recurring rules so jobs engine recomputes
  .post('/rules/:id/resume', async (c) => {
    const { db, user } = getCtx(c);
    if (!user) throw unauthorized();

    const id = c.req.param('id');

    const [existing] = await db
      .select({ id: automationRules.id, type: automationRules.type })
      .from(automationRules)
      .where(eq(automationRules.id, id));

    if (!existing) throw notFound('Automation rule not found');

    await db
      .update(automationRules)
      .set({
        isActive: true,
        ...(existing.type === 'recurring' && { nextFireAt: null }),
        updatedAt: new Date(),
      })
      .where(eq(automationRules.id, id));

    return c.json({ ok: true });
  })
  // DELETE /rules/:id — FK cascade removes steps, executions, recipients
  .delete('/rules/:id', async (c) => {
    const { db, user } = getCtx(c);
    if (!user) throw unauthorized();

    const id = c.req.param('id');

    const [existing] = await db
      .select({ id: automationRules.id })
      .from(automationRules)
      .where(eq(automationRules.id, id));

    if (!existing) throw notFound('Automation rule not found');

    await db.delete(automationRules).where(eq(automationRules.id, id));

    return c.json({ ok: true });
  })
  // POST /rules/:id/simulate — dry-run: resolve audience + build step timeline, no writes
  .post('/rules/:id/simulate', async (c) => {
    const { db, user } = getCtx(c);
    if (!user) throw unauthorized();

    const id = c.req.param('id');

    const [rule] = await db
      .select()
      .from(automationRules)
      .where(eq(automationRules.id, id));

    if (!rule) throw notFound('Automation rule not found');

    const steps = await db
      .select()
      .from(automationRuleSteps)
      .where(eq(automationRuleSteps.ruleId, id))
      .orderBy(automationRuleSteps.sequence);

    const filterResult = audienceFilterSchema.safeParse(rule.audienceFilter);
    const filter: AudienceFilter = filterResult.success
      ? filterResult.data
      : { excludeOptedOut: true as const };

    const fullWhere = buildFullAudienceWhere(db, filter);

    const [samples, [{ total }]] = await Promise.all([
      db
        .select({
          id: contacts.id,
          name: contacts.name,
          phone: contacts.phone,
          role: contacts.role,
        })
        .from(contacts)
        .where(fullWhere)
        .limit(5),
      db.select({ total: count() }).from(contacts).where(fullWhere),
    ]);

    const timeline = steps.map((step) => ({
      sequence: step.sequence,
      offsetDays: step.offsetDays,
      sendAtTime: step.sendAtTime,
      delayHours: step.delayHours,
      templateName: step.templateName,
      templateLanguage: step.templateLanguage,
      isFinal: step.isFinal,
      isReplyGated: step.delayHours != null,
    }));

    return c.json({ audienceCount: total, samples, timeline });
  })
  // POST /rules/:id/audience-preview — preview matching contacts for the rule's stored filter
  .post('/rules/:id/audience-preview', async (c) => {
    const { db, user } = getCtx(c);
    if (!user) throw unauthorized();

    const id = c.req.param('id');

    const [rule] = await db
      .select({ audienceFilter: automationRules.audienceFilter })
      .from(automationRules)
      .where(eq(automationRules.id, id));

    if (!rule) throw notFound('Automation rule not found');

    const filterResult = audienceFilterSchema.safeParse(rule.audienceFilter);
    const filter = filterResult.success
      ? filterResult.data
      : { excludeOptedOut: true as const };

    const fullWhere = buildFullAudienceWhere(db, filter);

    const [samples, [{ total }]] = await Promise.all([
      db
        .select({
          id: contacts.id,
          name: contacts.name,
          phone: contacts.phone,
          role: contacts.role,
        })
        .from(contacts)
        .where(fullWhere)
        .limit(5),
      db.select({ total: count() }).from(contacts).where(fullWhere),
    ]);

    return c.json({ count: total, samples, renderedTemplate: '' });
  });
