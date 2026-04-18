import { describe, expect, it } from 'bun:test'
import type { AgentEvent } from '@server/contracts/event'
import { EventBus } from './event-bus'
import { makeLlmCall, mockProvider } from './llm-call'

describe('llmCall chokepoint', () => {
  it('emits one llm_call event per invocation with full shape', async () => {
    const bus = new EventBus()
    const events: AgentEvent[] = []
    bus.subscribe((e) => {
      events.push(e)
    })
    const llmCall = makeLlmCall({
      events: bus,
      provider: mockProvider({ id: 'mock', responseText: 'hi', tokensIn: 7, tokensOut: 2, costUsd: 0.01 }),
      defaultModel: 'gpt-mock',
      wakeContext: { tenantId: 't1', conversationId: 'c1', wakeId: 'w1', turnIndex: 0 },
    })
    const result = await llmCall('agent.turn', { messages: [{ role: 'user', content: 'hi' }] })
    expect(result.task).toBe('agent.turn')
    expect(result.content).toBe('hi')
    expect(events).toHaveLength(1)
    const evt = events[0]
    if (!evt) throw new Error('no event emitted')
    expect(evt.type).toBe('llm_call')
    if (evt.type !== 'llm_call') throw new Error('unreachable')
    expect(evt.task).toBe('agent.turn')
    expect(evt.model).toBe('gpt-mock')
    expect(evt.provider).toBe('mock')
    expect(evt.tokensIn).toBe(7)
    expect(evt.tokensOut).toBe(2)
    expect(evt.costUsd).toBe(0.01)
    expect(typeof evt.latencyMs).toBe('number')
    expect(evt.cacheHit).toBe(false)
  })

  it('threads wakeId + tenantId + conversationId from wake context', async () => {
    const bus = new EventBus()
    const events: AgentEvent[] = []
    bus.subscribe((e) => {
      events.push(e)
    })
    const llmCall = makeLlmCall({
      events: bus,
      provider: mockProvider(),
      defaultModel: 'gpt-mock',
      wakeContext: { tenantId: 'tenant-x', conversationId: 'conv-y', wakeId: 'wake-z', turnIndex: 3 },
    })
    await llmCall('scorer.answer_relevancy', {})
    const evt = events[0]
    if (!evt) throw new Error('no event emitted')
    expect(evt.wakeId).toBe('wake-z')
    expect(evt.conversationId).toBe('conv-y')
    expect(evt.tenantId).toBe('tenant-x')
    expect(evt.turnIndex).toBe(3)
  })

  it('task tag reaches both result and event', async () => {
    const bus = new EventBus()
    const events: AgentEvent[] = []
    bus.subscribe((e) => {
      events.push(e)
    })
    const llmCall = makeLlmCall({
      events: bus,
      provider: mockProvider(),
      defaultModel: 'gpt-mock',
      wakeContext: { tenantId: 't1', conversationId: 'c1', wakeId: 'w1', turnIndex: 0 },
    })
    const result = await llmCall('drive.caption.image', {})
    expect(result.task).toBe('drive.caption.image')
    const evt = events[0]
    if (!evt || evt.type !== 'llm_call') throw new Error('missing llm_call')
    expect(evt.task).toBe('drive.caption.image')
  })
})
