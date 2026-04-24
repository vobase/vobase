import { describe, expect, test } from 'bun:test'

import { queryCommands } from './query'
import type { WakeContext } from './types'

// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
// Helpers
// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

function stubCtx(overrides?: Partial<WakeContext>): WakeContext {
  return {
    db: {} as WakeContext['db'],
    deps: { db: {} as WakeContext['db'] } as WakeContext['deps'],
    conversationId: 'conv-1',
    contactId: 'contact-1',
    agentId: 'agent-1',
    ...overrides,
  }
}

// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
// Registry shape
// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

describe('queryCommands registry', () => {
  test('exports all 4 commands', () => {
    expect(Object.keys(queryCommands).sort()).toEqual(['analyze-media', 'list-conversations', 'recall', 'search-kb'])
  })

  test('all values are functions', () => {
    for (const handler of Object.values(queryCommands)) {
      expect(typeof handler).toBe('function')
    }
  })
})

// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
// search — input validation
// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

describe('search-kb command', () => {
  const searchKb = queryCommands['search-kb']

  test('returns error when query is empty', async () => {
    const result = await searchKb([], {}, stubCtx())
    expect(result.exitCode).toBe(1)
    expect(result.stderr).toContain('Usage')
  })

  test('returns error when query is whitespace', async () => {
    const result = await searchKb(['  ', '  '], {}, stubCtx())
    expect(result.exitCode).toBe(1)
    expect(result.stderr).toContain('Usage')
  })
})

// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
// analyze-media — input validation
// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

describe('analyze-media command', () => {
  const analyzeMedia = queryCommands['analyze-media']

  test('returns error when no messageId', async () => {
    const result = await analyzeMedia([], {}, stubCtx())
    expect(result.exitCode).toBe(1)
    expect(result.stderr).toContain('Usage')
  })

  test('returns error when no question', async () => {
    const result = await analyzeMedia(['msg-1'], {}, stubCtx())
    expect(result.exitCode).toBe(1)
    expect(result.stderr).toContain('Usage')
  })

  test('returns error when storage unavailable', async () => {
    const ctx = stubCtx()
    ctx.deps = {
      ...ctx.deps,
      storage: undefined as unknown as WakeContext['deps']['storage'],
    }
    const result = await analyzeMedia(['msg-1', 'What', 'is', 'this?'], {}, ctx)
    expect(result.exitCode).toBe(1)
    expect(result.stderr).toContain('Storage service unavailable')
  })
})

// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
// list-conversations — needs DB so just validate handler shape
// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

describe('list-conversations command', () => {
  const listConversations = queryCommands['list-conversations']

  test('is a function accepting 3 args', () => {
    expect(typeof listConversations).toBe('function')
    expect(listConversations.length).toBe(3)
  })
})

// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
// recall — stub behavior
// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

describe('recall command', () => {
  const recall = queryCommands.recall

  test('returns error when query is empty', async () => {
    const result = await recall([], {}, stubCtx())
    expect(result.exitCode).toBe(1)
    expect(result.stderr).toContain('Usage')
  })

  test('returns stub message for valid query', async () => {
    const result = await recall(['previous', 'booking', 'info'], {}, stubCtx())
    expect(result.exitCode).toBe(0)
    expect(result.stdout).toContain('not yet implemented')
    expect(result.stdout).toContain('search-kb')
  })

  test('joins multiple positional args into query', async () => {
    const result = await recall(['multi', 'word', 'query'], {}, stubCtx())
    expect(result.exitCode).toBe(0)
    expect(result.stdout).toContain('not yet implemented')
  })
})
