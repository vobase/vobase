import { beforeEach, describe, expect, it } from 'bun:test'
import type { ChannelAdapter, OutboundMessage, SendResult } from '@vobase/core'

import { resetCircuit } from './delivery'
import {
  type BatchStats,
  type CounterDelta,
  executeSendBatch,
  type FinalOutcome,
  type HaltReason,
  type SendRecipient,
  translateWhatsAppError,
} from './send-executor'

// ─── Mock adapter ──────────────────────────────────────────────────

function makeAdapter(results: SendResult[]): {
  adapter: ChannelAdapter
  sent: OutboundMessage[]
} {
  const sent: OutboundMessage[] = []
  let idx = 0
  const adapter: ChannelAdapter = {
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
    async send(message) {
      sent.push(message)
      const next = results[idx++] ?? { success: true, messageId: `m-${idx}` }
      return next
    },
  }
  return { adapter, sent }
}

function makeRecipient(id: string): SendRecipient {
  return {
    id,
    phone: `+6591234${id}`,
    templateName: 'hello_world',
    templateLanguage: 'en',
    variables: { '1': 'Alice', '2': 'Order #42' },
  }
}

const CH = 'send-exec-test'

function freshState() {
  resetCircuit(CH)
}

// ─── Tests ─────────────────────────────────────────────────────────

describe('executeSendBatch — callback contract', () => {
  beforeEach(() => {
    freshState()
  })

  it('invokes every callback exactly as expected on a clean completion', async () => {
    const batches = [[makeRecipient('a'), makeRecipient('b')], [makeRecipient('c')], []]
    const loadBatchCalls: Array<{ offset: number; limit: number }> = []
    const updateRecipientCalls: Array<{ id: string; success: boolean }> = []
    const counterDeltas: CounterDelta[] = []
    const batchStats: BatchStats[] = []
    const finalOutcomes: FinalOutcome[] = []
    let circuitOpenCount = 0
    let haltCalls = 0

    const { adapter } = makeAdapter([
      { success: true, messageId: 'wa-1' },
      { success: true, messageId: 'wa-2' },
      { success: true, messageId: 'wa-3' },
    ])

    const result = await executeSendBatch({
      adapter,
      channelType: CH,
      batchSize: 2,
      batchDelayMs: 0,
      async loadBatch(offset, limit) {
        loadBatchCalls.push({ offset, limit })
        return batches.shift() ?? []
      },
      async updateRecipient(recipient, r) {
        updateRecipientCalls.push({ id: recipient.id, success: r.success })
      },
      async updateCounters(delta) {
        counterDeltas.push(delta)
      },
      async checkHalt() {
        haltCalls++
        return null
      },
      async onBatchComplete(stats) {
        batchStats.push(stats)
      },
      async onFinalize(outcome) {
        finalOutcomes.push(outcome)
      },
      async onCircuitOpen() {
        circuitOpenCount++
      },
    })

    expect(result.exit).toBe('completed')
    expect(result.batches).toBe(2)
    expect(result.totalSent).toBe(3)
    expect(result.totalFailed).toBe(0)

    // loadBatch invoked three times (two batches + empty terminator)
    expect(loadBatchCalls).toHaveLength(3)
    expect(loadBatchCalls[0]).toEqual({ offset: 0, limit: 2 })
    expect(loadBatchCalls[1]).toEqual({ offset: 2, limit: 2 })
    expect(loadBatchCalls[2]).toEqual({ offset: 3, limit: 2 })

    // updateRecipient fires once per recipient with success=true
    expect(updateRecipientCalls).toHaveLength(3)
    expect(updateRecipientCalls.every((c) => c.success)).toBe(true)

    // counters delta per batch
    expect(counterDeltas).toEqual([
      { sent: 2, failed: 0, skipped: 0 },
      { sent: 1, failed: 0, skipped: 0 },
    ])

    // onBatchComplete receives full BatchStats shape per batch
    expect(batchStats).toHaveLength(2)
    expect(batchStats[0]).toEqual({
      batchIndex: 0,
      sent: 2,
      failed: 0,
      skipped: 0,
    })
    expect(batchStats[1]).toEqual({
      batchIndex: 1,
      sent: 1,
      failed: 0,
      skipped: 0,
    })

    // checkHalt invoked once per non-empty batch
    expect(haltCalls).toBe(2)

    // onFinalize fires exactly once with 'completed'
    expect(finalOutcomes).toEqual(['completed'])

    // onCircuitOpen not invoked
    expect(circuitOpenCount).toBe(0)
  })

  it('cancel mid-loop halts before the next batch and finalizes as cancelled', async () => {
    const batches = [[makeRecipient('a'), makeRecipient('b')], [makeRecipient('c')], [makeRecipient('d')]]
    let halt: HaltReason | null = null
    const loadCount = { n: 0 }
    const finalOutcomes: FinalOutcome[] = []

    const { adapter } = makeAdapter([])

    const result = await executeSendBatch({
      adapter,
      channelType: CH,
      batchSize: 2,
      batchDelayMs: 0,
      async loadBatch() {
        loadCount.n++
        return batches.shift() ?? []
      },
      async updateRecipient() {},
      async updateCounters() {},
      async checkHalt() {
        return halt
      },
      async onBatchComplete() {
        // Cancel after first batch completes
        halt = 'cancelled'
      },
      async onFinalize(outcome) {
        finalOutcomes.push(outcome)
      },
      async onCircuitOpen() {},
    })

    expect(result.exit).toBe('cancelled')
    // Only one batch processed — second batch is NOT loaded after cancel
    expect(loadCount.n).toBe(1)
    expect(result.totalSent).toBe(2)
    // onFinalize fires once with 'cancelled'
    expect(finalOutcomes).toEqual(['cancelled'])
  })

  it('paused halt returns without invoking onFinalize', async () => {
    let halt: HaltReason | null = null
    const batches = [[makeRecipient('a')], [makeRecipient('b')]]
    const finalOutcomes: FinalOutcome[] = []

    const { adapter } = makeAdapter([])

    const result = await executeSendBatch({
      adapter,
      channelType: CH,
      batchSize: 1,
      batchDelayMs: 0,
      async loadBatch() {
        return batches.shift() ?? []
      },
      async updateRecipient() {},
      async updateCounters() {},
      async checkHalt() {
        return halt
      },
      async onBatchComplete() {
        halt = 'paused'
      },
      async onFinalize(outcome) {
        finalOutcomes.push(outcome)
      },
      async onCircuitOpen() {},
    })

    expect(result.exit).toBe('paused')
    expect(finalOutcomes).toEqual([])
  })

  it('fires onCircuitOpen exactly once when circuit trips mid-run', async () => {
    // Seed 6 recipients whose sends all fail — circuit threshold is 5.
    const batches = [
      [makeRecipient('a'), makeRecipient('b'), makeRecipient('c'), makeRecipient('d'), makeRecipient('e')],
      [makeRecipient('f')],
    ]
    const failResult: SendResult = {
      success: false,
      code: '131026',
      retryable: false,
    }
    const { adapter } = makeAdapter([failResult, failResult, failResult, failResult, failResult, failResult])

    let circuitOpenCount = 0
    const finalOutcomes: FinalOutcome[] = []

    const result = await executeSendBatch({
      adapter,
      channelType: CH,
      batchSize: 5,
      batchDelayMs: 0,
      async loadBatch() {
        return batches.shift() ?? []
      },
      async updateRecipient() {},
      async updateCounters() {},
      async checkHalt() {
        return null
      },
      async onBatchComplete() {},
      async onFinalize(outcome) {
        finalOutcomes.push(outcome)
      },
      async onCircuitOpen() {
        circuitOpenCount++
      },
    })

    // First batch's 5 failures trip the breaker; next iteration detects open and halts.
    expect(circuitOpenCount).toBe(1)
    expect(result.exit).toBe('circuit-open')
    expect(finalOutcomes).toEqual([])
  })

  it('failure translates WhatsApp error codes and forwards translated reason to updateRecipient', async () => {
    const { adapter } = makeAdapter([{ success: false, code: '131026', retryable: false }])
    const captured: SendResult[] = []
    const batches = [[makeRecipient('a')], []]

    await executeSendBatch({
      adapter,
      channelType: CH,
      batchSize: 1,
      batchDelayMs: 0,
      async loadBatch() {
        return batches.shift() ?? []
      },
      async updateRecipient(_r, result) {
        captured.push(result)
      },
      async updateCounters() {},
      async checkHalt() {
        return null
      },
      async onBatchComplete() {},
      async onFinalize() {},
      async onCircuitOpen() {},
    })

    expect(captured).toHaveLength(1)
    expect(captured[0].success).toBe(false)
    expect(captured[0].error).toBe('Invalid phone number')
  })

  it('finalizes as failed when every send fails but circuit stays closed', async () => {
    // Two failures — below circuit threshold of 5.
    const { adapter } = makeAdapter([
      { success: false, error: 'boom', retryable: true },
      { success: false, error: 'boom', retryable: true },
    ])
    const batches = [[makeRecipient('a'), makeRecipient('b')], []]
    const finalOutcomes: FinalOutcome[] = []

    const result = await executeSendBatch({
      adapter,
      channelType: CH,
      batchSize: 2,
      batchDelayMs: 0,
      async loadBatch() {
        return batches.shift() ?? []
      },
      async updateRecipient() {},
      async updateCounters() {},
      async checkHalt() {
        return null
      },
      async onBatchComplete() {},
      async onFinalize(outcome) {
        finalOutcomes.push(outcome)
      },
      async onCircuitOpen() {},
    })

    expect(result.exit).toBe('failed')
    expect(result.totalFailed).toBe(2)
    expect(finalOutcomes).toEqual(['failed'])
  })
})

describe('translateWhatsAppError', () => {
  it('maps known error codes', () => {
    expect(translateWhatsAppError('131026')).toBe('Invalid phone number')
    expect(translateWhatsAppError('130429')).toBe('Rate limited')
    expect(translateWhatsAppError('132000')).toBe('Template not found')
  })

  it('falls back for unknown codes', () => {
    expect(translateWhatsAppError('999999')).toBe('WhatsApp error: 999999')
  })
})
