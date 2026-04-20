/**
 * scorerObserver tests.
 *
 * - 2 inserts on turn_end (answer_relevancy + faithfulness)
 * - 0 inserts on turn_start
 * - timing order: turn_end handled → scorer_recorded events emitted
 */

import { beforeEach, describe, expect, it } from 'bun:test'
import type { AgentEvent, TurnEndEvent, TurnStartEvent } from '@server/contracts/event'
import type { ObserverContext } from '@server/contracts/observer'
import type { LlmResult, PluginContext } from '@server/contracts/plugin-context'
import type { ScopedDb } from '@server/contracts/scoped-db'
import { createScorerObserver } from './scorer'

type InsertedRow = { scorer: string; score: number; organizationId: string; wakeTurnIndex: number }
let insertedRows: InsertedRow[] = []
let emittedEvents: AgentEvent[] = []
let llmCallLog: string[] = []

beforeEach(() => {
  insertedRows = []
  emittedEvents = []
  llmCallLog = []
})

function makeMockDb(): unknown {
  return {
    insert: (_table: unknown) => ({
      values: (row: Record<string, unknown>) => {
        insertedRows.push({
          scorer: row.scorer as string,
          score: row.score as number,
          organizationId: row.organizationId as string,
          wakeTurnIndex: row.wakeTurnIndex as number,
        })
        return Promise.resolve()
      },
    }),
  }
}

async function mockLlmCall(task: string, _req: unknown): Promise<LlmResult<string>> {
  llmCallLog.push(task)
  return {
    task: task as LlmResult<string>['task'],
    model: 'test-model',
    provider: 'test',
    content: JSON.stringify({ score: 0.82, rationale: 'test rationale' }),
    tokensIn: 10,
    tokensOut: 10,
    cacheReadTokens: 0,
    costUsd: 0.0001,
    latencyMs: 50,
    cacheHit: false,
  }
}

function makeCtx(): ObserverContext {
  return {
    organizationId: 'org-scorer-1',
    conversationId: 'conv-scorer-1',
    wakeId: 'wake-scorer-1',
    ports: {} as ObserverContext['ports'],
    db: makeMockDb() as ScopedDb,
    logger: { debug: () => {}, info: () => {}, warn: () => {}, error: () => {} },
    realtime: { notify: () => {} },
  }
}

function makeBase() {
  return {
    ts: new Date(),
    wakeId: 'wake-scorer-1',
    conversationId: 'conv-scorer-1',
    organizationId: 'org-scorer-1',
    turnIndex: 1,
  }
}

function makeTurnStartEvent(): TurnStartEvent {
  return { type: 'turn_start', ...makeBase() }
}

function makeTurnEndEvent(turnIndex = 1): TurnEndEvent {
  return { type: 'turn_end', tokensIn: 100, tokensOut: 50, costUsd: 0.001, ...makeBase(), turnIndex }
}

describe('createScorerObserver', () => {
  it('has stable id', () => {
    const observer = createScorerObserver({
      llmCall: mockLlmCall as unknown as PluginContext['llmCall'],
      emit: () => {},
    })
    expect(observer.id).toBe('agents:scorer')
  })

  it('produces 0 DB inserts on turn_start', async () => {
    const observer = createScorerObserver({
      llmCall: mockLlmCall as unknown as PluginContext['llmCall'],
      emit: (e) => emittedEvents.push(e),
    })
    await observer.handle(makeTurnStartEvent(), makeCtx())
    expect(insertedRows).toHaveLength(0)
    expect(emittedEvents).toHaveLength(0)
  })

  it('produces 2 DB inserts on turn_end', async () => {
    const observer = createScorerObserver({
      llmCall: mockLlmCall as unknown as PluginContext['llmCall'],
      emit: (e) => emittedEvents.push(e),
    })
    await observer.handle(makeTurnEndEvent(), makeCtx())
    expect(insertedRows).toHaveLength(2)
  })

  it('inserts rows for answer_relevancy and faithfulness scorers', async () => {
    const observer = createScorerObserver({
      llmCall: mockLlmCall as unknown as PluginContext['llmCall'],
      emit: (e) => emittedEvents.push(e),
    })
    await observer.handle(makeTurnEndEvent(), makeCtx())
    const scorers = insertedRows.map((r) => r.scorer).sort()
    expect(scorers).toEqual(['answer_relevancy', 'faithfulness'])
  })

  it('inserts rows with correct organizationId and wakeTurnIndex', async () => {
    const observer = createScorerObserver({
      llmCall: mockLlmCall as unknown as PluginContext['llmCall'],
      emit: (e) => emittedEvents.push(e),
    })
    await observer.handle(makeTurnEndEvent(3), makeCtx())
    for (const row of insertedRows) {
      expect(row.organizationId).toBe('org-scorer-1')
      expect(row.wakeTurnIndex).toBe(3)
    }
  })

  it('score values are clamped to 0..1', async () => {
    const outOfRangeLlm = async (_task: string, _req: unknown): Promise<LlmResult<string>> => ({
      task: 'scorer.answer_relevancy',
      model: 'test-model',
      provider: 'test',
      content: JSON.stringify({ score: 1.5, rationale: 'out of range' }),
      tokensIn: 10,
      tokensOut: 10,
      cacheReadTokens: 0,
      costUsd: 0.0001,
      latencyMs: 50,
      cacheHit: false,
    })

    const observer = createScorerObserver({
      llmCall: outOfRangeLlm as unknown as PluginContext['llmCall'],
      emit: (e) => emittedEvents.push(e),
    })
    await observer.handle(makeTurnEndEvent(), makeCtx())
    for (const row of insertedRows) {
      expect(row.score).toBeLessThanOrEqual(1)
      expect(row.score).toBeGreaterThanOrEqual(0)
    }
  })

  // Timing: turn_end handled → scorer_recorded emitted in that order
  it('emits 2 scorer_recorded events after turn_end is processed', async () => {
    const timeline: string[] = []
    const observer = createScorerObserver({
      llmCall: mockLlmCall as unknown as PluginContext['llmCall'],
      emit: (e) => {
        timeline.push(e.type)
        emittedEvents.push(e)
      },
    })

    await observer.handle(makeTurnEndEvent(), makeCtx())

    // Both scorer_recorded events should appear after the turn_end was handled
    const scorerEvents = emittedEvents.filter((e) => e.type === 'scorer_recorded')
    expect(scorerEvents).toHaveLength(2)
    // All timeline entries must be scorer_recorded (turn_end handling is caller's concern)
    expect(timeline.every((t) => t === 'scorer_recorded')).toBe(true)
  })

  it('scorer_recorded events carry correct scorerId and sourceLlmTask', async () => {
    const observer = createScorerObserver({
      llmCall: mockLlmCall as unknown as PluginContext['llmCall'],
      emit: (e) => emittedEvents.push(e),
    })
    await observer.handle(makeTurnEndEvent(), makeCtx())

    const relevancyEvt = emittedEvents.find(
      (e) => e.type === 'scorer_recorded' && (e as { scorerId?: string }).scorerId === 'answer_relevancy',
    )
    const faithfulnessEvt = emittedEvents.find(
      (e) => e.type === 'scorer_recorded' && (e as { scorerId?: string }).scorerId === 'faithfulness',
    )

    expect(relevancyEvt).toBeDefined()
    expect(faithfulnessEvt).toBeDefined()

    expect((relevancyEvt as { sourceLlmTask?: string }).sourceLlmTask).toBe('scorer.answer_relevancy')
    expect((faithfulnessEvt as { sourceLlmTask?: string }).sourceLlmTask).toBe('scorer.faithfulness')
  })

  it('passes scorer.answer_relevancy and scorer.faithfulness tasks to llmCall', async () => {
    const observer = createScorerObserver({
      llmCall: mockLlmCall as unknown as PluginContext['llmCall'],
      emit: (e) => emittedEvents.push(e),
    })
    await observer.handle(makeTurnEndEvent(), makeCtx())
    expect(llmCallLog.sort()).toEqual(['scorer.answer_relevancy', 'scorer.faithfulness'])
  })

  it('uses buffered message content to build scoring context', async () => {
    let capturedUserMessage = ''
    const capturingLlm = async (task: string, req: unknown): Promise<LlmResult<string>> => {
      const r = req as { messages?: Array<{ content: string }> }
      if (task === 'scorer.answer_relevancy' && r.messages?.[0]) {
        capturedUserMessage = r.messages[0].content
      }
      return {
        task: task as LlmResult<string>['task'],
        model: 'test-model',
        provider: 'test',
        content: JSON.stringify({ score: 0.9, rationale: 'ok' }),
        tokensIn: 5,
        tokensOut: 5,
        cacheReadTokens: 0,
        costUsd: 0,
        latencyMs: 10,
        cacheHit: false,
      }
    }

    const observer = createScorerObserver({
      llmCall: capturingLlm as unknown as PluginContext['llmCall'],
      emit: () => {},
    })
    const ctx = makeCtx()

    // Emit a user message_end before turn_end
    await observer.handle(
      {
        type: 'message_end',
        messageId: 'msg-1',
        role: 'user',
        content: 'What is the refund policy?',
        ...makeBase(),
      },
      ctx,
    )
    await observer.handle(makeTurnEndEvent(), ctx)

    expect(capturedUserMessage).toContain('What is the refund policy?')
  })

  it('cleans up buffer on agent_end to prevent memory leaks', async () => {
    const observer = createScorerObserver({
      llmCall: mockLlmCall as unknown as PluginContext['llmCall'],
      emit: () => {},
    })
    const ctx = makeCtx()

    await observer.handle(
      { type: 'message_end', messageId: 'msg-2', role: 'assistant', content: 'Answer.', ...makeBase() },
      ctx,
    )
    // agent_end should clear the buffer
    await observer.handle({ type: 'agent_end', reason: 'complete', ...makeBase() }, ctx)

    // After cleanup, a new turn_end should score with empty content (no crash)
    await observer.handle(makeTurnEndEvent(), ctx)
    expect(insertedRows).toHaveLength(2)
  })
})
