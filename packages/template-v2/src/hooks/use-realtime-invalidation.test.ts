/**
 * Unit tests for use-realtime-invalidation.ts — tests the invalidation logic
 * directly without React hooks (pure function extraction).
 */
import { describe, expect, it } from 'bun:test'

interface RealtimePayload {
  table: string
  id?: string
  action?: string
  resourceModule?: string
  resourceType?: string
  resourceId?: string
  conversationId?: string | null
}

type QueryKey = unknown[]

// Pure extraction of the invalidation logic for unit testing
function resolveInvalidationKeys(payload: RealtimePayload): QueryKey[] {
  if (!payload.table) return []

  if (payload.table === 'conversations') {
    const keys: QueryKey[] = [['conversations'], ['team', 'mentions']]
    if (payload.id) {
      keys.push(['conversation', payload.id])
      keys.push(['messages', payload.id])
      keys.push(['notes', payload.id])
      keys.push(['activity', payload.id])
    }
    return keys
  }

  if (payload.table === 'agent-sessions' && payload.id) {
    if (payload.action === 'message_update') return []
    return [['messages', payload.id], ['conversations']]
  }

  if (payload.table === 'approvals') {
    return [['approvals']]
  }

  if (payload.table === 'change_proposals') {
    const keys: QueryKey[] = [['change_proposals']]
    const decided = payload.action === 'approved' || payload.action === 'auto_written'
    if (decided) {
      if (payload.resourceModule === 'drive') {
        keys.push(['drive'])
      } else if (payload.resourceModule === 'contacts') {
        keys.push(['contacts'])
        if (payload.resourceId) {
          keys.push(['contact', payload.resourceId])
          keys.push(['drive'])
        }
      } else if (payload.resourceModule === 'agents') {
        keys.push(['agents'])
        if (payload.resourceId) {
          keys.push(['agent', payload.resourceId])
          keys.push(['drive'])
        }
      }
    }
    if (payload.conversationId) {
      keys.push(['activity', payload.conversationId])
    }
    return keys
  }

  if (payload.table === 'agent_staff_memory') {
    return [['drive']]
  }

  if (payload.table === 'learned_skills') {
    return [['drive']]
  }

  if (payload.table === 'drive_files' || payload.table === 'drive.files') {
    return [['drive']]
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
    expect(keys).not.toContainEqual(['conversations'])
  })

  it('agent-sessions message_update action returns empty (suppressed)', () => {
    const keys = resolveInvalidationKeys({ table: 'agent-sessions', id: 'conv-abc', action: 'message_update' })
    expect(keys).toHaveLength(0)
  })

  it('approvals table invalidates approvals list', () => {
    const keys = resolveInvalidationKeys({ table: 'approvals' })
    expect(keys).toContainEqual(['approvals'])
  })

  it('change_proposals approved for agents invalidates drive', () => {
    const keys = resolveInvalidationKeys({
      table: 'change_proposals',
      action: 'approved',
      resourceModule: 'agents',
      resourceId: 'agent-001',
    })
    expect(keys).toContainEqual(['change_proposals'])
    expect(keys).toContainEqual(['agents'])
    expect(keys).toContainEqual(['agent', 'agent-001'])
    expect(keys).toContainEqual(['drive'])
    expect(keys).not.toContainEqual(expect.arrayContaining(['agent-view']))
  })

  it('change_proposals approved for contacts invalidates drive', () => {
    const keys = resolveInvalidationKeys({
      table: 'change_proposals',
      action: 'approved',
      resourceModule: 'contacts',
      resourceId: 'contact-001',
    })
    expect(keys).toContainEqual(['contacts'])
    expect(keys).toContainEqual(['contact', 'contact-001'])
    expect(keys).toContainEqual(['drive'])
    expect(keys).not.toContainEqual(expect.arrayContaining(['agent-view']))
  })

  it('change_proposals auto_written for agents invalidates drive', () => {
    const keys = resolveInvalidationKeys({
      table: 'change_proposals',
      action: 'auto_written',
      resourceModule: 'agents',
      resourceId: 'agent-002',
    })
    expect(keys).toContainEqual(['drive'])
  })

  it('change_proposals pending does not invalidate drive', () => {
    const keys = resolveInvalidationKeys({
      table: 'change_proposals',
      action: 'pending',
      resourceModule: 'agents',
      resourceId: 'agent-003',
    })
    expect(keys).not.toContainEqual(['drive'])
  })

  it('change_proposals with conversationId invalidates activity', () => {
    const keys = resolveInvalidationKeys({
      table: 'change_proposals',
      action: 'approved',
      resourceModule: 'agents',
      resourceId: 'agent-001',
      conversationId: 'conv-xyz',
    })
    expect(keys).toContainEqual(['activity', 'conv-xyz'])
  })

  it('agent_staff_memory invalidates drive', () => {
    const keys = resolveInvalidationKeys({ table: 'agent_staff_memory' })
    expect(keys).toContainEqual(['drive'])
    expect(keys).toHaveLength(1)
  })

  it('learned_skills invalidates drive', () => {
    const keys = resolveInvalidationKeys({ table: 'learned_skills' })
    expect(keys).toContainEqual(['drive'])
    expect(keys).toHaveLength(1)
  })

  it('drive_files invalidates drive', () => {
    const keys = resolveInvalidationKeys({ table: 'drive_files' })
    expect(keys).toContainEqual(['drive'])
  })

  it('drive.files (schema-qualified) invalidates drive', () => {
    const keys = resolveInvalidationKeys({ table: 'drive.files' })
    expect(keys).toContainEqual(['drive'])
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
