import { logger } from '@vobase/core';
import { and, eq, inArray, isNotNull } from 'drizzle-orm';

import {
  automationRecipients,
  automationRuleSteps,
  automationRules,
  contacts,
} from '../schema';
import { addDaysToIsoDate } from './automation-engine';
import { getModuleDeps } from './deps';

/**
 * For each active date-relative rule, cancel queued recipients whose
 * contact's date attribute no longer matches the stored dateValue.
 *
 * A stored recipient is stale when:
 *   contact.attributes[rule.dateAttribute] ≠ addDaysToIsoDate(dateValue, -offsetDays)
 *
 * Cancellation sets status='skipped', failureReason='date_changed'.
 * The evaluate-date-relative job will re-create a fresh recipient on the
 * next tick when the contact's new date is within range.
 */
export async function rescheduleDateRelativeRecipients(): Promise<{
  cancelled: number;
}> {
  const { db } = getModuleDeps();

  const rules = await db
    .select({
      id: automationRules.id,
      dateAttribute: automationRules.dateAttribute,
    })
    .from(automationRules)
    .where(
      and(
        eq(automationRules.type, 'date-relative'),
        eq(automationRules.isActive, true),
        isNotNull(automationRules.dateAttribute),
      ),
    );

  let totalCancelled = 0;

  for (const rule of rules) {
    const { dateAttribute } = rule;
    if (!dateAttribute) continue;

    const queued = await db
      .select({
        id: automationRecipients.id,
        contactId: automationRecipients.contactId,
        dateValue: automationRecipients.dateValue,
        currentStep: automationRecipients.currentStep,
      })
      .from(automationRecipients)
      .where(
        and(
          eq(automationRecipients.ruleId, rule.id),
          eq(automationRecipients.status, 'queued'),
          isNotNull(automationRecipients.dateValue),
        ),
      );

    if (queued.length === 0) continue;

    const stepSeqs = [
      ...new Set(
        queued.map((r) => r.currentStep).filter((s): s is number => s != null),
      ),
    ];
    const steps = await db
      .select({
        sequence: automationRuleSteps.sequence,
        offsetDays: automationRuleSteps.offsetDays,
      })
      .from(automationRuleSteps)
      .where(
        and(
          eq(automationRuleSteps.ruleId, rule.id),
          inArray(automationRuleSteps.sequence, stepSeqs),
        ),
      );
    const offsetByStep = new Map(
      steps.map((s) => [s.sequence, s.offsetDays ?? 0]),
    );

    const contactIds = [...new Set(queued.map((r) => r.contactId))];
    const contactRows = await db
      .select({ id: contacts.id, attributes: contacts.attributes })
      .from(contacts)
      .where(inArray(contacts.id, contactIds));
    const attrByContact = new Map(
      contactRows.map((c) => [
        c.id,
        ((c.attributes ?? {}) as Record<string, unknown>)[dateAttribute],
      ]),
    );

    const staleIds: string[] = [];
    for (const r of queued) {
      if (!r.dateValue) continue;
      const offsetDays = offsetByStep.get(r.currentStep ?? 1) ?? 0;
      const expectedContactDate = addDaysToIsoDate(r.dateValue, -offsetDays);
      const actual = attrByContact.get(r.contactId);
      if (
        typeof actual !== 'string' ||
        actual.slice(0, 10) !== expectedContactDate
      ) {
        staleIds.push(r.id);
      }
    }

    if (staleIds.length === 0) continue;

    await db
      .update(automationRecipients)
      .set({ status: 'skipped', failureReason: 'date_changed' })
      .where(inArray(automationRecipients.id, staleIds));

    totalCancelled += staleIds.length;
    logger.info('[automation-reschedule] Cancelled stale queued recipients', {
      ruleId: rule.id,
      cancelled: staleIds.length,
    });
  }

  return { cancelled: totalCancelled };
}
