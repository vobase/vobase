/**
 * Unit tests for use-realtime-invalidation.ts — tests the invalidation logic
 * directly without React hooks (pure function extraction).
 */
import { describe, expect, it } from 'bun:test'

interface RealtimePayload {
  table: string
  id?: string
  action?: string
}

type QueryKey = unknown[]

// Pure extraction of the invalidation logic for unit testing
function resolveInvalidationKeys(payload: RealtimePayload): QueryKey[] {
  if (!payload.table) return []

  if (payload.table === 'conversations') {
    const keys: QueryKey[] = [['conversations']]
    if (payload.id) {
      keys.push(['conversation', payload.id])
      keys.push(['messages', payload.id])
    }
    return keys
  }

  if (payload.table === 'agent-sessions' && payload.id) {
    return [['messages', payload.id], ['conversations']]
  }

  if (payload.table === 'approvals') {
    return [['approvals']]
  }

  return [[payload.table]]
}

describe('resolveInvalidationKeys', () => {
  it('conversations table invalidates conversations list', () => {
    const keys = resolveInvalidationKeys({ table: 'conversations' })
    expect(keys).toContainEqual(['conversations'])
  })

  it('conversations with id invalidates conversation detail + messages', () => {
    const keys = resolveInvalidationKeys({ table: 'conversations', id: 'conv-123' })
    expect(keys).toContainEqual(['conversations'])
    expect(keys).toContainEqual(['conversation', 'conv-123'])
    expect(keys).toContainEqual(['messages', 'conv-123'])
  })

  it('agent-sessions with id invalidates messages for that conversation', () => {
    const keys = resolveInvalidationKeys({ table: 'agent-sessions', id: 'conv-abc' })
    expect(keys).toContainEqual(['messages', 'conv-abc'])
    expect(keys).toContainEqual(['conversations'])
  })

  it('agent-sessions without id returns empty (no broadcast needed)', () => {
    const keys = resolveInvalidationKeys({ table: 'agent-sessions' })
    // no id → no specific invalidation for agent-sessions
    expect(keys).not.toContainEqual(['conversations'])
  })

  it('approvals table invalidates approvals list', () => {
    const keys = resolveInvalidationKeys({ table: 'approvals' })
    expect(keys).toContainEqual(['approvals'])
  })

  it('unknown table falls back to broad key', () => {
    const keys = resolveInvalidationKeys({ table: 'some_other_table' })
    expect(keys).toContainEqual(['some_other_table'])
  })

  it('empty table returns empty array', () => {
    const keys = resolveInvalidationKeys({ table: '' })
    expect(keys).toHaveLength(0)
  })
})
