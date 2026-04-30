import { logger } from '@vobase/core'
import { and, eq, sql } from 'drizzle-orm'

import {
  automationExecutions,
  automationRecipients,
  automationRuleSteps,
  automationRules,
  channelInstances,
} from '../schema'
import { getModuleDeps } from './deps'
import {
  type BatchStats,
  type CounterDelta,
  executeSendBatch,
  type FinalOutcome,
  type HaltReason,
  type SendRecipient,
} from './send-executor'

/** Send one automation step against `executionId` via the generic send-executor. */
export async function executeAutomationStep(
  executionId: string,
  stepSequence: number,
  options?: { batchSize?: number; delayMs?: number },
): Promise<void> {
  const { db, scheduler, channels, realtime } = getModuleDeps()

  const [execution] = await db.select().from(automationExecutions).where(eq(automationExecutions.id, executionId))
  if (!execution) {
    logger.warn('[automation-executor] Execution not found', { executionId })
    return
  }
  if (execution.status !== 'running') {
    logger.info('[automation-executor] Execution not in running status — skipping', {
      executionId,
      status: execution.status,
    })
    return
  }

  const [rule] = await db.select().from(automationRules).where(eq(automationRules.id, execution.ruleId))
  if (!rule) {
    logger.warn('[automation-executor] Rule not found', {
      executionId,
      ruleId: execution.ruleId,
    })
    return
  }

  const [step] = await db
    .select()
    .from(automationRuleSteps)
    .where(and(eq(automationRuleSteps.ruleId, rule.id), eq(automationRuleSteps.sequence, stepSequence)))
  if (!step) {
    logger.warn('[automation-executor] Step not found — finalizing execution', {
      ruleId: rule.id,
      stepSequence,
    })
    await db
      .update(automationExecutions)
      .set({ status: 'failed', completedAt: new Date() })
      .where(eq(automationExecutions.id, executionId))
    return
  }

  const [nextStep] = await db
    .select({ delayHours: automationRuleSteps.delayHours })
    .from(automationRuleSteps)
    .where(and(eq(automationRuleSteps.ruleId, rule.id), eq(automationRuleSteps.sequence, stepSequence + 1)))

  const [channelInstance] = await db
    .select()
    .from(channelInstances)
    .where(eq(channelInstances.id, rule.channelInstanceId))

  const adapter = channels.getAdapter(rule.channelInstanceId) ?? channels.getAdapter('whatsapp')
  if (!adapter) {
    logger.warn('[automation-executor] No adapter found', {
      executionId,
      channelInstanceId: rule.channelInstanceId,
    })
    await db
      .update(automationExecutions)
      .set({ status: 'failed', completedAt: new Date() })
      .where(eq(automationExecutions.id, executionId))
    return
  }

  const channelType = channelInstance?.type ?? 'whatsapp'

  await executeSendBatch({
    adapter,
    channelType,
    batchSize: options?.batchSize,
    batchDelayMs: options?.delayMs,
    logContext: { executionId, ruleId: rule.id, stepSequence },

    async loadBatch(_offset, limit) {
      const rows = await db
        .select()
        .from(automationRecipients)
        .where(and(eq(automationRecipients.executionId, executionId), eq(automationRecipients.status, 'queued')))
        .limit(limit)

      return rows.map<SendRecipient>((r) => ({
        id: r.id,
        phone: r.phone,
        templateName: step.templateName,
        templateLanguage: step.templateLanguage,
        variables: (r.variables ?? {}) as Record<string, string>,
      }))
    },

    async updateRecipient(recipient, result) {
      if (result.success) {
        const nextStepAt =
          nextStep && nextStep.delayHours != null ? new Date(Date.now() + nextStep.delayHours * 3_600_000) : null
        await db
          .update(automationRecipients)
          .set({
            status: 'sent',
            externalMessageId: result.messageId ?? null,
            sentAt: new Date(),
            nextStepAt,
          })
          .where(eq(automationRecipients.id, recipient.id))
      } else {
        await db
          .update(automationRecipients)
          .set({
            status: 'failed',
            failureReason: result.error ?? 'Send failed',
          })
          .where(eq(automationRecipients.id, recipient.id))
      }
    },

    async updateCounters(delta: CounterDelta) {
      await db
        .update(automationExecutions)
        .set({
          sentCount: sql`${automationExecutions.sentCount} + ${delta.sent}`,
          failedCount: sql`${automationExecutions.failedCount} + ${delta.failed}`,
          skippedCount: sql`${automationExecutions.skippedCount} + ${delta.skipped}`,
        })
        .where(eq(automationExecutions.id, executionId))
    },

    async checkHalt(): Promise<HaltReason | null> {
      const [current] = await db
        .select({ isActive: automationRules.isActive })
        .from(automationRules)
        .where(eq(automationRules.id, rule.id))
      if (current && !current.isActive) return 'paused'
      return null
    },

    async onBatchComplete(_stats: BatchStats) {
      await realtime
        .notify({
          table: 'automation-executions',
          id: executionId,
          action: 'update',
        })
        .catch(() => {})
    },

    async onCircuitOpen() {
      await scheduler.add(
        'automation:execute-step',
        { executionId, stepSequence },
        {
          startAfter: new Date(Date.now() + 60_000).toISOString(),
          singletonKey: `${executionId}:${stepSequence}:retry`,
        },
      )
    },

    async onFinalize(outcome: FinalOutcome) {
      const completedAt = new Date()
      // automation_executions.status CHECK allows only ('running','completed','failed').
      const finalStatus = outcome === 'completed' ? 'completed' : 'failed'

      await db
        .update(automationExecutions)
        .set({ status: finalStatus, completedAt })
        .where(eq(automationExecutions.id, executionId))

      await realtime
        .notify({
          table: 'automation-executions',
          id: executionId,
          action: 'update',
        })
        .catch(() => {})

      logger.info('[automation-executor] Step finished', {
        executionId,
        ruleId: rule.id,
        stepSequence,
        outcome: finalStatus,
      })
    },
  })
}
