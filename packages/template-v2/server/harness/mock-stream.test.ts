import { describe, expect, it } from 'bun:test'
import { mockStream, mockStreamTurns } from './mock-stream'

async function drain<T>(gen: AsyncGenerator<T, void, unknown>): Promise<T[]> {
  const out: T[] = []
  for await (const ev of gen) out.push(ev)
  return out
}

describe('mockStream', () => {
  it('yields the supplied events in order with a default finish', async () => {
    const fn = mockStream([
      { type: 'text-delta', delta: 'he' },
      { type: 'text-delta', delta: 'llo' },
    ])
    const events = await drain(fn())
    expect(events.map((e) => e.type)).toEqual(['text-delta', 'text-delta', 'finish'])
  })

  it('synthesizes a text-delta before finish when caller only sent finish (B4)', async () => {
    const fn = mockStream([{ type: 'finish', finishReason: 'stop' }])
    const events = await drain(fn())
    expect(events[0]?.type).toBe('text-delta')
    expect(events[events.length - 1]?.type).toBe('finish')
  })

  it('mockStreamTurns returns a different script per call', async () => {
    const fn = mockStreamTurns([
      { events: [{ type: 'text-delta', delta: 't1' }] },
      { events: [{ type: 'text-delta', delta: 't2' }] },
    ])
    const a = await drain(fn())
    const b = await drain(fn())
    expect(a.some((e) => e.type === 'text-delta' && e.delta === 't1')).toBe(true)
    expect(b.some((e) => e.type === 'text-delta' && e.delta === 't2')).toBe(true)
  })
})
