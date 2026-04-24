import { logger, type Scheduler, type VobaseDb } from '@vobase/core'
import { CronExpressionParser } from 'cron-parser'
import { format } from 'date-fns'
import { toZonedTime } from 'date-fns-tz'
import { and, eq, inArray, lte, or, sql } from 'drizzle-orm'

import {
  automationExecutions,
  automationRecipients,
  automationRuleSteps,
  automationRules,
  contactLabels,
  contacts,
} from '../schema'
import { type AudienceFilter, audienceFilterSchema, buildAudienceConditions } from './audience-filter'
import { getAudienceResolver, getResolverContext } from './audience-resolvers'
import { getModuleDeps } from './deps'

// ─── Shared helpers ────────────────────────────────────────────────

function parseAudience(raw: unknown): AudienceFilter {
  const parsed = audienceFilterSchema.safeParse(raw ?? {})
  return parsed.success ? parsed.data : audienceFilterSchema.parse({ excludeOptedOut: true })
}

export interface AudienceContact {
  id: string
  phone: string
  name: string | null
  attributes: unknown
}

async function resolveAudience(db: VobaseDb, filter: AudienceFilter): Promise<AudienceContact[]> {
  const where = buildAudienceConditions(filter)
  const conditions = where ? [where] : []
  if (filter.labelIds && filter.labelIds.length > 0) {
    const sub = db
      .selectDistinct({ contactId: contactLabels.contactId })
      .from(contactLabels)
      .where(inArray(contactLabels.labelId, filter.labelIds))
    conditions.push(inArray(contacts.id, sub))
  }
  const rows = await db
    .select({
      id: contacts.id,
      phone: contacts.phone,
      name: contacts.name,
      attributes: contacts.attributes,
    })
    .from(contacts)
    .where(conditions.length > 1 ? and(...conditions) : conditions[0])
  return rows.filter((r): r is AudienceContact => typeof r.phone === 'string' && r.phone.length > 0)
}

interface ResolvedAudience {
  audience: AudienceContact[]
  resolverVariables: Map<string, Record<string, unknown>> | null
}

async function resolveAudienceForRule(
  db: VobaseDb,
  rule: typeof automationRules.$inferSelect,
): Promise<ResolvedAudience> {
  if (rule.audienceResolverName) {
    const resolver = getAudienceResolver(rule.audienceResolverName)
    if (!resolver) {
      throw new Error(`[automation-engine] Unknown audience resolver: ${rule.audienceResolverName}`)
    }
    const results = await resolver(getResolverContext(), rule.parameters)
    if (results.length === 0) {
      return { audience: [], resolverVariables: new Map() }
    }
    const ids = results.map((r) => r.contactId)
    const rows = await db
      .select({
        id: contacts.id,
        phone: contacts.phone,
        name: contacts.name,
        attributes: contacts.attributes,
      })
      .from(contacts)
      .where(inArray(contacts.id, ids))
    const variablesById = new Map<string, Record<string, unknown>>()
    for (const r of results) {
      if (r.variables) variablesById.set(r.contactId, r.variables)
    }
    return {
      audience: rows.filter((r): r is AudienceContact => typeof r.phone === 'string' && r.phone.length > 0),
      resolverVariables: variablesById,
    }
  }
  const filter = parseAudience(rule.audienceFilter)
  return {
    audience: await resolveAudience(db, filter),
    resolverVariables: null,
  }
}

function renderVariables(
  mapping: Record<string, unknown>,
  contact: { name?: string | null; phone?: string | null; attributes: unknown },
): Record<string, string> {
  const attrs = (contact.attributes ?? {}) as Record<string, unknown>
  const ctx: Record<string, unknown> = {
    name: contact.name ?? '',
    phone: contact.phone ?? '',
    ...Object.fromEntries(Object.entries(attrs).map(([k, v]) => [`attributes.${k}`, v])),
  }
  const out: Record<string, string> = {}
  for (const [key, src] of Object.entries(mapping)) {
    const raw = typeof src === 'string' ? (ctx[src] ?? '') : ''
    out[key] = typeof raw === 'string' ? raw : String(raw)
  }
  return out
}

/** Compute the next cron firing time in the rule's timezone (returns a UTC Date). */
export function computeNextFireAt(cron: string, timezone: string, fromDate: Date): Date | null {
  try {
    const iter = CronExpressionParser.parse(cron, {
      currentDate: fromDate,
      tz: timezone,
    })
    return iter.next().toDate()
  } catch (err) {
    logger.warn('[automation-engine] Invalid cron expression', {
      cron,
      timezone,
      error: err,
    })
    return null
  }
}

function todayInTz(now: Date, timezone: string): { date: string; time: string } {
  const zoned = toZonedTime(now, timezone)
  return {
    date: format(zoned, 'yyyy-MM-dd'),
    time: format(zoned, 'HH:mm'),
  }
}

export function addDaysToIsoDate(isoDate: string, days: number): string {
  const [y, m, d] = isoDate.split('-').map(Number)
  const date = new Date(Date.UTC(y ?? 0, (m ?? 1) - 1, d ?? 1))
  date.setUTCDate(date.getUTCDate() + days)
  return date.toISOString().slice(0, 10)
}

// ─── Recurring evaluator ───────────────────────────────────────────

/**
 * Find recurring rules due to fire (nextFireAt <= now), materialize one
 * execution + one recipient per audience contact, enqueue execute-step.
 * Updates rule.nextFireAt to the next cron boundary using rule.timezone.
 */
export async function evaluateRecurringRules(now: Date = new Date()): Promise<{
  rulesFired: number
  recipientsInserted: number
}> {
  const { db, scheduler } = getModuleDeps()

  const dueRules = await db
    .select()
    .from(automationRules)
    .where(
      and(
        eq(automationRules.type, 'recurring'),
        eq(automationRules.isActive, true),
        or(sql`${automationRules.nextFireAt} IS NULL`, lte(automationRules.nextFireAt, now)),
      ),
    )

  const counts = await forEachRuleBounded(dueRules, async (rule) => {
    const firstStep = await loadStep(db, rule.id, 1)
    if (!firstStep) {
      logger.warn('[automation-engine] Recurring rule has no step 1 — skipping', { ruleId: rule.id })
      await advanceRuleCursor(db, rule.id, rule.schedule, rule.timezone, now)
      return 0
    }

    const { audience, resolverVariables } = await resolveAudienceForRule(db, rule)
    const inserted = await fireRule({
      db,
      scheduler,
      rule,
      step: firstStep,
      now,
      dateValue: null,
      contactOverride: audience,
      resolverVariables,
    })
    await advanceRuleCursor(db, rule.id, rule.schedule, rule.timezone, now)
    return inserted
  })

  const totalRecipients = counts.reduce((a, b) => a + b, 0)

  if (dueRules.length > 0) {
    logger.info('[automation-engine] Recurring rules fired', {
      rulesFired: dueRules.length,
      recipientsInserted: totalRecipients,
    })
  }

  return { rulesFired: dueRules.length, recipientsInserted: totalRecipients }
}

/** Run `fn` against each rule with bounded concurrency. */
const RULE_CONCURRENCY = 4
async function forEachRuleBounded<T, R>(items: T[], fn: (item: T) => Promise<R>): Promise<R[]> {
  const results: R[] = []
  for (let i = 0; i < items.length; i += RULE_CONCURRENCY) {
    const batch = items.slice(i, i + RULE_CONCURRENCY)
    const batchResults = await Promise.all(batch.map(fn))
    results.push(...batchResults)
  }
  return results
}

// ─── Date-relative evaluator ───────────────────────────────────────

/**
 * For each active date-relative rule, compute today-in-rule-timezone and
 * check each step 1 against every audience contact's date attribute. A
 * recipient fires when:
 *   - contact.attributes[rule.dateAttribute] (as YYYY-MM-DD) + offsetDays
 *     equals today-in-tz
 *   - step.sendAtTime is null OR matches current HH:MM in the rule tz
 *   - no prior (ruleId, contactId, dateValue) row exists (partial unique)
 *
 * dateValue stored = today-in-rule-timezone (not UTC). The unique index
 * guarantees each (rule, contact, day) fires at most once.
 */
export async function evaluateDateRelativeRules(
  now: Date = new Date(),
): Promise<{ rulesFired: number; recipientsInserted: number }> {
  const { db, scheduler } = getModuleDeps()

  const rules = await db
    .select()
    .from(automationRules)
    .where(and(eq(automationRules.type, 'date-relative'), eq(automationRules.isActive, true)))

  const counts = await forEachRuleBounded(rules, async (rule) => {
    const { dateAttribute } = rule
    if (!dateAttribute) return 0
    const step = await loadStep(db, rule.id, 1)
    if (!step) return 0

    const { date: todayStr, time: nowHm } = todayInTz(now, rule.timezone)
    if (step.sendAtTime && step.sendAtTime !== nowHm) return 0

    const offset = step.offsetDays ?? 0
    const targetEventDate = addDaysToIsoDate(todayStr, -offset)

    const { audience, resolverVariables } = await resolveAudienceForRule(db, rule)

    const matches = audience.filter((c) => {
      const attrs = (c.attributes ?? {}) as Record<string, unknown>
      const raw = attrs[dateAttribute]
      if (typeof raw !== 'string') return false
      return raw.slice(0, 10) === targetEventDate
    })
    if (matches.length === 0) return 0

    return fireRule({
      db,
      scheduler,
      rule,
      step,
      now,
      dateValue: todayStr,
      contactOverride: matches,
      resolverVariables,
    })
  })

  const totalRecipients = counts.reduce((a, b) => a + b, 0)
  const rulesFired = counts.filter((n) => n > 0).length

  if (rulesFired > 0) {
    logger.info('[automation-engine] Date-relative rules fired', {
      rulesFired,
      recipientsInserted: totalRecipients,
    })
  }

  return { rulesFired, recipientsInserted: totalRecipients }
}

// ─── Fire one rule ─────────────────────────────────────────────────

async function loadStep(
  db: VobaseDb,
  ruleId: string,
  sequence: number,
): Promise<typeof automationRuleSteps.$inferSelect | null> {
  const [row] = await db
    .select()
    .from(automationRuleSteps)
    .where(and(eq(automationRuleSteps.ruleId, ruleId), eq(automationRuleSteps.sequence, sequence)))
  return row ?? null
}

interface FireRuleArgs {
  db: VobaseDb
  scheduler: Scheduler
  rule: typeof automationRules.$inferSelect
  step: typeof automationRuleSteps.$inferSelect
  now: Date
  dateValue: string | null
  contactOverride?: AudienceContact[]
  resolverVariables?: Map<string, Record<string, unknown>> | null
}

async function fireRule(args: FireRuleArgs): Promise<number> {
  const { db, scheduler, rule, step, now, dateValue, contactOverride, resolverVariables } = args

  const audience = contactOverride ?? (await resolveAudience(db, parseAudience(rule.audienceFilter)))
  if (audience.length === 0) return 0

  const [execution] = await db
    .insert(automationExecutions)
    .values({
      ruleId: rule.id,
      stepSequence: step.sequence,
      firedAt: now,
      status: 'running',
    })
    .returning()
  if (!execution) return 0

  const mapping = (step.variableMapping ?? {}) as Record<string, unknown>
  const values = audience.map((c) => {
    const rendered = renderVariables(mapping, c)
    const extra = resolverVariables?.get(c.id)
    const merged: Record<string, unknown> = extra ? { ...rendered, ...extra } : rendered
    return {
      executionId: execution.id,
      ruleId: rule.id,
      contactId: c.id,
      phone: c.phone,
      variables: merged,
      currentStep: step.sequence,
      status: 'queued' as const,
      dateValue,
    }
  })

  if (values.length === 0) {
    await db
      .update(automationExecutions)
      .set({ status: 'completed', completedAt: now, totalRecipients: 0 })
      .where(eq(automationExecutions.id, execution.id))
    return 0
  }

  const inserted = await db
    .insert(automationRecipients)
    .values(values)
    .onConflictDoNothing({
      target: [automationRecipients.ruleId, automationRecipients.contactId, automationRecipients.dateValue],
      where: sql`date_value IS NOT NULL`,
    })
    .returning({ id: automationRecipients.id })

  const actualCount = inserted.length
  await db
    .update(automationExecutions)
    .set({ totalRecipients: actualCount })
    .where(eq(automationExecutions.id, execution.id))

  await db.update(automationRules).set({ lastFiredAt: now }).where(eq(automationRules.id, rule.id))

  if (actualCount === 0) {
    await db
      .update(automationExecutions)
      .set({ status: 'completed', completedAt: now })
      .where(eq(automationExecutions.id, execution.id))
    return 0
  }

  await scheduler.add(
    'automation:execute-step',
    { executionId: execution.id, stepSequence: step.sequence },
    { singletonKey: `${execution.id}:${step.sequence}` },
  )
  return actualCount
}

async function advanceRuleCursor(
  db: VobaseDb,
  ruleId: string,
  schedule: string | null,
  timezone: string,
  now: Date,
): Promise<void> {
  if (!schedule) return
  const next = computeNextFireAt(schedule, timezone, now)
  await db.update(automationRules).set({ nextFireAt: next }).where(eq(automationRules.id, ruleId))
}
