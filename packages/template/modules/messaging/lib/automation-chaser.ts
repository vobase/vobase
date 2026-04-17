import { logger, type VobaseDb } from '@vobase/core';
import { and, eq, inArray, sql } from 'drizzle-orm';

import {
  automationExecutions,
  automationRecipients,
  automationRuleSteps,
} from '../schema';
import { getModuleDeps } from './deps';

interface ClaimRow {
  id: string;
  rule_id: string;
  current_step: number;
}

/**
 * Claim chaser-due recipients, create one new execution row per
 * (rule, nextStep) group, migrate recipients to that execution with
 * currentStep = nextStep and status='queued', then enqueue execute-step.
 *
 * Concurrency: `SELECT ... FOR UPDATE SKIP LOCKED` on the hot index
 * (status, next_step_at) lets two runners partition work without duplicate
 * enqueues. The singletonKey `${executionId}:${stepSequence}` on the job
 * also guards against duplicate jobs for the same step.
 *
 * Gating:
 *   - status IN ('sent','delivered','read')   never advance queued/failed
 *   - replied_at IS NULL                      inbound reply short-circuits
 *   - next_step_at IS NOT NULL AND <= now
 *   - a next step exists for (rule_id, current_step + 1)
 */
export async function advanceChasers(
  now: Date = new Date(),
  opts?: { limit?: number },
): Promise<{ advanced: number }> {
  const { db, scheduler } = getModuleDeps();
  const limit = opts?.limit ?? 500;

  const claims = await claim(db, now, limit);
  if (claims.length === 0) return { advanced: 0 };

  const groups = groupByNextStep(claims);

  for (const [groupKey, rows] of groups) {
    const [ruleIdPart, nextStepPart] = groupKey.split('::');
    const ruleId = ruleIdPart ?? '';
    const nextSeq = Number(nextStepPart);
    if (!ruleId || !Number.isFinite(nextSeq)) continue;

    const [execution] = await db
      .insert(automationExecutions)
      .values({
        ruleId,
        stepSequence: nextSeq,
        firedAt: now,
        status: 'running',
        totalRecipients: rows.length,
      })
      .returning();
    if (!execution) continue;

    const ids = rows.map((r) => r.id);
    await db
      .update(automationRecipients)
      .set({
        executionId: execution.id,
        currentStep: nextSeq,
        status: 'queued',
        nextStepAt: null,
      })
      .where(inArray(automationRecipients.id, ids));

    await scheduler.add(
      'automation:execute-step',
      { executionId: execution.id, stepSequence: nextSeq },
      { singletonKey: `${execution.id}:${nextSeq}` },
    );
  }

  logger.info('[automation-chaser] Advanced chasers', {
    recipients: claims.length,
    groups: groups.size,
  });

  return { advanced: claims.length };
}

async function claim(
  db: VobaseDb,
  now: Date,
  limit: number,
): Promise<ClaimRow[]> {
  const result = await db.execute(sql`
    UPDATE "messaging"."automation_recipients" r
    SET status = 'chaser_paused'
    WHERE r.id IN (
      SELECT inner_r.id
      FROM "messaging"."automation_recipients" inner_r
      INNER JOIN "messaging"."automation_rule_steps" next_step
        ON next_step.rule_id = inner_r.rule_id
        AND next_step.sequence = inner_r.current_step + 1
      WHERE inner_r.status IN ('sent', 'delivered', 'read')
        AND inner_r.replied_at IS NULL
        AND inner_r.next_step_at IS NOT NULL
        AND inner_r.next_step_at <= ${now}
      ORDER BY inner_r.next_step_at ASC
      LIMIT ${limit}
      FOR UPDATE OF inner_r SKIP LOCKED
    )
    RETURNING r.id, r.rule_id, r.current_step
  `);

  const rows = Array.isArray(result)
    ? result
    : ((result as { rows?: unknown[] }).rows ?? []);
  return rows as ClaimRow[];
}

function groupByNextStep(claims: ClaimRow[]): Map<string, ClaimRow[]> {
  const groups = new Map<string, ClaimRow[]>();
  for (const row of claims) {
    const key = `${row.rule_id}::${row.current_step + 1}`;
    let bucket = groups.get(key);
    if (!bucket) {
      bucket = [];
      groups.set(key, bucket);
    }
    bucket.push(row);
  }
  return groups;
}

/**
 * Re-fetch the next step definition for a rule. Exposed for tests so they
 * can assert advancer gating against the steps table without inlining the
 * SQL. Returns null if no step at `sequence` exists.
 */
export async function findNextStep(
  db: VobaseDb,
  ruleId: string,
  sequence: number,
): Promise<typeof automationRuleSteps.$inferSelect | null> {
  const [row] = await db
    .select()
    .from(automationRuleSteps)
    .where(
      and(
        eq(automationRuleSteps.ruleId, ruleId),
        eq(automationRuleSteps.sequence, sequence),
      ),
    );
  return row ?? null;
}
