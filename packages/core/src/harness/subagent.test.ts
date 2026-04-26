import { afterEach, beforeEach, describe, expect, it } from 'bun:test'

import { __resetJournalServiceForTests, installJournalService } from './journal'
import {
  __resetSubagentRegistryForTests,
  appendChildEvent,
  cascadeAbort,
  DEFAULT_MAX_SUBAGENT_DEPTH,
  getSubagentChildren,
  getSubagentDepth,
  registerSubagent,
  SubagentDepthExceededError,
  subagentJournalNamespace,
  unregisterSubagent,
} from './subagent'
import type { AbortContext } from './types'

function mkAbort(): AbortContext {
  return { wakeAbort: new AbortController(), reason: null }
}

let journals: Array<{ wakeId: string | null; event: Record<string, unknown> }>

beforeEach(() => {
  __resetSubagentRegistryForTests()
  __resetJournalServiceForTests()
  journals = []
  installJournalService({
    append: (input) => {
      journals.push({ wakeId: input.wakeId ?? null, event: input.event as Record<string, unknown> })
      return Promise.resolve()
    },
    getLastWakeTail: () => Promise.resolve({ interrupted: false }),
    getLatestTurnIndex: () => Promise.resolve(0),
  })
})

afterEach(() => {
  __resetSubagentRegistryForTests()
  __resetJournalServiceForTests()
})

describe('registerSubagent', () => {
  it('records parent → child link with depth 1 by default', () => {
    const child = registerSubagent({
      parentWakeId: 'p',
      childWakeId: 'c',
      goal: 'find a doc',
      abort: mkAbort(),
    })
    expect(child.childWakeId).toBe('c')
    expect(getSubagentChildren('p')).toHaveLength(1)
    expect(getSubagentDepth('c')).toBe(1)
  })

  it('rejects nesting beyond DEFAULT_MAX_SUBAGENT_DEPTH', () => {
    registerSubagent({ parentWakeId: 'p', childWakeId: 'c', goal: 'g', abort: mkAbort() })
    expect(() => registerSubagent({ parentWakeId: 'c', childWakeId: 'gc', goal: 'g', abort: mkAbort() })).toThrow(
      SubagentDepthExceededError,
    )
    expect(DEFAULT_MAX_SUBAGENT_DEPTH).toBe(1)
  })

  it('honours an explicit higher maxDepth when callers opt in', () => {
    registerSubagent({ parentWakeId: 'p', childWakeId: 'c', goal: 'g', abort: mkAbort() })
    const grand = registerSubagent({
      parentWakeId: 'c',
      childWakeId: 'gc',
      goal: 'deeper',
      abort: mkAbort(),
      maxDepth: 2,
    })
    expect(grand.childWakeId).toBe('gc')
  })
})

describe('cascadeAbort', () => {
  it('aborts every registered child of a parent and skips already-aborted ones', () => {
    const a = mkAbort()
    const b = mkAbort()
    registerSubagent({ parentWakeId: 'p', childWakeId: 'a', goal: 'g', abort: a })
    registerSubagent({ parentWakeId: 'p', childWakeId: 'b', goal: 'g', abort: b })

    const r = cascadeAbort('p', 'parent steered')
    expect(r.aborted).toBe(2)
    expect(a.wakeAbort.signal.aborted).toBe(true)
    expect(b.wakeAbort.signal.aborted).toBe(true)
    expect(a.reason).toBe('parent steered')

    const r2 = cascadeAbort('p', 'second cascade')
    expect(r2.aborted).toBe(0)
  })

  it('returns 0 when the parent has no registered children', () => {
    expect(cascadeAbort('nobody', 'why').aborted).toBe(0)
  })
})

describe('unregisterSubagent', () => {
  it('removes the child entry but leaves siblings intact', () => {
    registerSubagent({ parentWakeId: 'p', childWakeId: 'a', goal: 'g', abort: mkAbort() })
    registerSubagent({ parentWakeId: 'p', childWakeId: 'b', goal: 'g', abort: mkAbort() })
    unregisterSubagent('p', 'a')
    expect(getSubagentChildren('p').map((c) => c.childWakeId)).toEqual(['b'])
  })
})

describe('appendChildEvent', () => {
  it('namespaces the payload with subagent:<childWakeId> and journals against the parent', async () => {
    await appendChildEvent({
      organizationId: 'o1',
      conversationId: 'c1',
      parentWakeId: 'p',
      childWakeId: 'c',
      turnIndex: 0,
      event: { type: 'turn_end' },
    })
    expect(journals).toHaveLength(1)
    expect(journals[0]?.wakeId).toBe('p')
    const payload = journals[0]?.event.payload as Record<string, unknown>
    expect(payload._subagent).toBe('subagent:c')
    expect(payload.parentWakeId).toBe('p')
  })
})

describe('subagentJournalNamespace', () => {
  it('formats the namespace string consistently', () => {
    expect(subagentJournalNamespace('w42')).toBe('subagent:w42')
  })
})
