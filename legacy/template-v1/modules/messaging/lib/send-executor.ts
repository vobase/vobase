import type { ChannelAdapter, OutboundMessage, SendResult } from '@vobase/core'
import { logger } from '@vobase/core'

import { isCircuitOpen, recordCircuitFailure, recordCircuitSuccess } from './delivery'

// ─── WhatsApp Error Translation ────────────────────────────────────

export function translateWhatsAppError(code: string): string {
  switch (code) {
    case '131026':
      return 'Invalid phone number'
    case '130429':
      return 'Rate limited'
    case '131047':
      return 'Message undeliverable'
    case '131051':
      return 'Unsupported message type'
    case '131056':
      return 'Rate limited (pair rate)'
    case '132000':
      return 'Template not found'
    case '132012':
      return 'Template parameter mismatch'
    default:
      return `WhatsApp error: ${code}`
  }
}

// ─── Callback Contract ─────────────────────────────────────────────

export interface SendRecipient {
  id: string
  phone: string
  templateName: string
  templateLanguage: string
  variables: Record<string, string>
}

export interface CounterDelta {
  sent: number
  failed: number
  skipped: number
}

export interface BatchStats {
  batchIndex: number
  sent: number
  failed: number
  skipped: number
}

export type HaltReason = 'cancelled' | 'paused'
export type FinalOutcome = 'completed' | 'failed' | 'cancelled'

export interface SendBatchOptions {
  /** Channel adapter used for outbound sends. */
  adapter: ChannelAdapter
  /** Channel type key for the in-memory circuit breaker (e.g. 'whatsapp'). */
  channelType: string
  /** Load the next batch of queued recipients. Empty array signals completion. */
  loadBatch(offset: number, limit: number): Promise<SendRecipient[]>
  /** Persist the per-recipient send outcome. */
  updateRecipient(recipient: SendRecipient, result: SendResult): Promise<void>
  /** Atomically add per-batch totals to the parent aggregate. */
  updateCounters(delta: CounterDelta): Promise<void>
  /** Return 'cancelled' / 'paused' to halt before the next batch, or null to continue. */
  checkHalt(): Promise<HaltReason | null>
  /** Side-effects after each batch (realtime notify, logging, etc.). */
  onBatchComplete(stats: BatchStats): Promise<void>
  /** Terminal hook fired exactly once on normal completion or cancelled halt. */
  onFinalize(outcome: FinalOutcome): Promise<void>
  /** Circuit-open hook: caller pauses work and reschedules retry. Fires at most once. */
  onCircuitOpen(): Promise<void>
  /** Number of recipients per batch. Default 50. */
  batchSize?: number
  /** Millisecond delay between batches for pacing. Default 100. */
  batchDelayMs?: number
  /** Structured context mixed into executor log lines. */
  logContext?: Record<string, unknown>
}

export type ExecutorExitReason = 'completed' | 'failed' | 'cancelled' | 'paused' | 'circuit-open'

export interface SendBatchResult {
  exit: ExecutorExitReason
  batches: number
  totalSent: number
  totalFailed: number
  totalSkipped: number
}

// ─── Executor ──────────────────────────────────────────────────────

/**
 * Generic batched outbound template send loop. Owns circuit-breaker checks,
 * per-batch concurrency, WhatsApp error translation, and pacing. All table
 * I/O is routed through the callback contract — the executor itself never
 * references broadcast or automation tables.
 */
export async function executeSendBatch(opts: SendBatchOptions): Promise<SendBatchResult> {
  const batchSize = opts.batchSize ?? 50
  const batchDelayMs = opts.batchDelayMs ?? 100
  const logCtx = opts.logContext ?? {}

  let batchIndex = 0
  let offset = 0
  let totalSent = 0
  let totalFailed = 0
  const totalSkipped = 0

  while (true) {
    if (isCircuitOpen(opts.channelType)) {
      logger.warn('[send-executor] Circuit open — pausing', logCtx)
      await opts.onCircuitOpen()
      return {
        exit: 'circuit-open',
        batches: batchIndex,
        totalSent,
        totalFailed,
        totalSkipped,
      }
    }

    const batch = await opts.loadBatch(offset, batchSize)
    if (batch.length === 0) break

    let batchSent = 0
    let batchFailed = 0

    const settled = await Promise.allSettled(batch.map((recipient) => sendOne(opts, recipient)))

    for (const entry of settled) {
      if (entry.status === 'fulfilled') {
        if (entry.value === 'sent') {
          batchSent++
        } else {
          batchFailed++
        }
      } else {
        batchFailed++
        logger.error('[send-executor] Unexpected send error', {
          ...logCtx,
          error: entry.reason,
        })
      }
    }

    await opts.updateCounters({
      sent: batchSent,
      failed: batchFailed,
      skipped: 0,
    })

    await opts.onBatchComplete({
      batchIndex,
      sent: batchSent,
      failed: batchFailed,
      skipped: 0,
    })

    totalSent += batchSent
    totalFailed += batchFailed
    batchIndex++
    offset += batch.length

    const halt = await opts.checkHalt()
    if (halt === 'cancelled') {
      logger.info('[send-executor] Halted: cancelled', logCtx)
      await opts.onFinalize('cancelled')
      return {
        exit: 'cancelled',
        batches: batchIndex,
        totalSent,
        totalFailed,
        totalSkipped,
      }
    }
    if (halt === 'paused') {
      logger.info('[send-executor] Halted: paused', logCtx)
      return {
        exit: 'paused',
        batches: batchIndex,
        totalSent,
        totalFailed,
        totalSkipped,
      }
    }

    await Bun.sleep(batchDelayMs)
  }

  const outcome: FinalOutcome = totalSent === 0 && totalFailed > 0 ? 'failed' : 'completed'
  await opts.onFinalize(outcome)
  return {
    exit: outcome,
    batches: batchIndex,
    totalSent,
    totalFailed,
    totalSkipped,
  }
}

// ─── Per-Recipient Dispatch ────────────────────────────────────────

async function sendOne(opts: SendBatchOptions, recipient: SendRecipient): Promise<'sent' | 'failed'> {
  const outbound = buildOutbound(recipient)
  const result = await opts.adapter.send(outbound)

  if (result.success) {
    recordCircuitSuccess(opts.channelType)
    await opts.updateRecipient(recipient, result)
    return 'sent'
  }

  recordCircuitFailure(opts.channelType)
  const failureReason = result.code ? translateWhatsAppError(result.code) : (result.error ?? 'Send failed')
  await opts.updateRecipient(recipient, {
    ...result,
    error: failureReason,
  })
  return 'failed'
}

function buildOutbound(recipient: SendRecipient): OutboundMessage {
  // Variables are stored as { "1": "value", "2": "value" } — numeric order matters.
  const sortedValues = Object.keys(recipient.variables)
    .sort((a, b) => Number(a) - Number(b))
    .map((key) => recipient.variables[key])

  return {
    to: recipient.phone,
    template: {
      name: recipient.templateName,
      language: recipient.templateLanguage,
      components:
        sortedValues.length > 0
          ? [
              {
                type: 'body',
                parameters: sortedValues.map((v) => ({
                  type: 'text' as const,
                  text: v,
                })),
              },
            ]
          : [],
    },
  }
}
