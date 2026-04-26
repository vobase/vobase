import { afterEach, beforeEach, describe, expect, it } from 'bun:test'

import {
  createConcurrencyGate,
  journalDispatchComplete,
  journalDispatchStart,
  mintIdempotencyKey,
  resolveDispatchOrphans,
  scanDispatchOrphans,
} from './dispatch'
import { __resetJournalServiceForTests, installJournalService } from './journal'
import type { AgentTool } from './types'

interface JournalRow {
  type: string
  payload: Record<string, unknown>
}

let journals: JournalRow[]

beforeEach(() => {
  __resetJournalServiceForTests()
  journals = []
  installJournalService({
    append: (input) => {
      const ev = input.event as { type: string }
      journals.push({ type: ev.type, payload: input as unknown as Record<string, unknown> })
      return Promise.resolve()
    },
    getLastWakeTail: () => Promise.resolve({ interrupted: false }),
    getLatestTurnIndex: () => Promise.resolve(0),
  })
})

afterEach(() => {
  __resetJournalServiceForTests()
})

describe('mintIdempotencyKey', () => {
  it('joins wakeId + toolCallId stably', () => {
    expect(mintIdempotencyKey('w1', 'tc1')).toBe('w1:tc1')
  })
})

describe('journalDispatchStart / Complete', () => {
  it('emits paired events with the same idempotencyKey', async () => {
    const key = await journalDispatchStart({
      organizationId: 'o1',
      conversationId: 'c1',
      wakeId: 'w1',
      turnIndex: 0,
      toolCallId: 'tc1',
      toolName: 'send_reply',
    })
    expect(key).toBe('w1:tc1')
    await journalDispatchComplete({
      organizationId: 'o1',
      conversationId: 'c1',
      wakeId: 'w1',
      turnIndex: 0,
      toolCallId: 'tc1',
      toolName: 'send_reply',
      idempotencyKey: key,
      ok: true,
      durationMs: 12,
    })
    expect(journals.map((j) => j.type)).toEqual(['tool_dispatch_started', 'tool_dispatch_completed'])
    const completed = journals[1]?.payload.event as { idempotencyKey: string; ok: boolean }
    expect(completed.idempotencyKey).toBe(key)
    expect(completed.ok).toBe(true)
  })
})

describe('scanDispatchOrphans', () => {
  it('returns starts without a matching complete', () => {
    const events = [
      {
        type: 'tool_dispatch_started',
        toolCallId: 'tc1',
        toolName: 'send_reply',
        idempotencyKey: 'w1:tc1',
        turnIndex: 0,
      },
      {
        type: 'tool_dispatch_started',
        toolCallId: 'tc2',
        toolName: 'send_card',
        idempotencyKey: 'w1:tc2',
        turnIndex: 0,
      },
      {
        type: 'tool_dispatch_completed',
        toolCallId: 'tc1',
        toolName: 'send_reply',
        idempotencyKey: 'w1:tc1',
        turnIndex: 0,
      },
    ]
    const orphans = scanDispatchOrphans({ events })
    expect(orphans).toHaveLength(1)
    expect(orphans[0]?.toolCallId).toBe('tc2')
    expect(orphans[0]?.idempotencyKey).toBe('w1:tc2')
  })

  it('ignores starts with no idempotencyKey field', () => {
    const orphans = scanDispatchOrphans({
      events: [{ type: 'tool_dispatch_started', toolCallId: 'tc1', toolName: 'send_reply', turnIndex: 0 }],
    })
    expect(orphans).toHaveLength(0)
  })
})

describe('resolveDispatchOrphans', () => {
  const mkTool = (name: string, idempotent: boolean): Pick<AgentTool, 'name' | 'idempotent'> => ({ name, idempotent })

  it('flags non-idempotent orphans as lost and journals tool_dispatch_lost', async () => {
    const result = await resolveDispatchOrphans({
      organizationId: 'o1',
      conversationId: 'c1',
      wakeId: 'w1',
      tools: [mkTool('send_reply', false)],
      orphans: [{ toolCallId: 'tc1', toolName: 'send_reply', idempotencyKey: 'w1:tc1', turnIndex: 0 }],
    })
    expect(result.lost).toHaveLength(1)
    expect(result.replayable).toHaveLength(0)
    expect(journals.map((j) => j.type)).toEqual(['tool_dispatch_lost'])
  })

  it('classifies idempotent orphans as replayable and skips the journal', async () => {
    const result = await resolveDispatchOrphans({
      organizationId: 'o1',
      conversationId: 'c1',
      wakeId: 'w1',
      tools: [mkTool('memory_set', true)],
      orphans: [{ toolCallId: 'tc1', toolName: 'memory_set', idempotencyKey: 'w1:tc1', turnIndex: 0 }],
    })
    expect(result.replayable).toHaveLength(1)
    expect(result.lost).toHaveLength(0)
    expect(journals).toHaveLength(0)
  })

  it('treats unregistered tools as non-idempotent (lost)', async () => {
    const result = await resolveDispatchOrphans({
      organizationId: 'o1',
      conversationId: 'c1',
      wakeId: 'w1',
      tools: [],
      orphans: [{ toolCallId: 'tc1', toolName: 'mystery', idempotencyKey: 'w1:tc1', turnIndex: 0 }],
    })
    expect(result.lost).toHaveLength(1)
  })
})

describe('createConcurrencyGate', () => {
  it('caps in-flight dispatches at maxConcurrent and releases when callback fires', () => {
    const gate = createConcurrencyGate()
    const a = gate.tryAcquire('book_slot', 1)
    expect(a).not.toBeNull()
    const b = gate.tryAcquire('book_slot', 1)
    expect(b).toBeNull()
    expect(gate.inFlight('book_slot')).toBe(1)
    a?.()
    expect(gate.inFlight('book_slot')).toBe(0)
    const c = gate.tryAcquire('book_slot', 1)
    expect(c).not.toBeNull()
  })

  it('treats maxConcurrent <= 0 as 1', () => {
    const gate = createConcurrencyGate()
    const a = gate.tryAcquire('weird', 0)
    expect(a).not.toBeNull()
    const b = gate.tryAcquire('weird', 0)
    expect(b).toBeNull()
  })

  it('release is idempotent — second call is a no-op', () => {
    const gate = createConcurrencyGate()
    const release = gate.tryAcquire('t', 2)
    expect(release).not.toBeNull()
    release?.()
    release?.()
    expect(gate.inFlight('t')).toBe(0)
  })

  it('separates counts per tool name', () => {
    const gate = createConcurrencyGate()
    gate.tryAcquire('a', 1)
    gate.tryAcquire('b', 1)
    expect(gate.inFlight('a')).toBe(1)
    expect(gate.inFlight('b')).toBe(1)
  })
})
