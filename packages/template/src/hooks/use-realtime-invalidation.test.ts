/**
 * Unit tests for use-realtime-invalidation.ts — drives the exported
 * `createRealtimeInvalidationHandler` against a fake QueryClient slice, so the
 * routing table under test is the real implementation (previously these tests
 * ran against an inline copy of the logic, which could drift).
 */

import { describe, expect, it } from 'bun:test'
import { STAFF_REPLY_MUTATION_KEY } from '@modules/messaging/hooks/use-staff-reply'
import type { InvalidateQueryFilters } from '@tanstack/react-query'

import type { RealtimePayload } from './use-realtime-invalidation'
import { createRealtimeInvalidationHandler, type InvalidationClient } from './use-realtime-invalidation'

type QueryKey = unknown[]

function makeClient(opts?: { mutatingConversationIds?: string[] }) {
  const mutating = new Set(opts?.mutatingConversationIds ?? [])
  const calls: Array<InvalidateQueryFilters | undefined> = []
  const client: InvalidationClient = {
    invalidateQueries: (filters?: InvalidateQueryFilters) => {
      calls.push(filters)
      return Promise.resolve()
    },
    isMutating: (filters) => {
      const key = filters?.mutationKey as readonly unknown[] | undefined
      if (key && key[0] === STAFF_REPLY_MUTATION_KEY) return mutating.has(key[1] as string) ? 1 : 0
      return 0
    },
  }
  return { calls, client }
}

/** Run one invalidate event through the real handler and return the invalidated query keys. */
function invalidatedKeys(payload: RealtimePayload, opts?: { mutatingConversationIds?: string[] }): QueryKey[] {
  const { calls, client } = makeClient(opts)
  const handle = createRealtimeInvalidationHandler(client)
  handle({ event: 'invalidate', data: JSON.stringify(payload) })
  return calls.map((c) => (c?.queryKey as QueryKey | undefined) ?? ['<all>'])
}

/** Evaluate an invalidate-all's predicate against a synthetic query key. */
function runPredicate(filters: InvalidateQueryFilters | undefined, queryKey: unknown[]): boolean {
  const predicate = filters?.predicate
  if (!predicate) throw new Error('expected a predicate-based invalidate-all filter')
  return predicate({ queryKey } as unknown as Parameters<typeof predicate>[0])
}

describe('createRealtimeInvalidationHandler — connection lifecycle', () => {
  it('skips the first connected event and refetches everything on reconnect', () => {
    const { calls, client } = makeClient()
    const handle = createRealtimeInvalidationHandler(client)

    handle({ event: 'connected', data: '{}' })
    expect(calls).toHaveLength(0)

    // Second `connected` = EventSource auto-reconnect: events in the gap were dropped.
    handle({ event: 'connected', data: '{}' })
    expect(calls).toHaveLength(1)
    // invalidate-all refetches everything except messages of a conversation mid-reply.
    expect(runPredicate(calls[0], ['conversations'])).toBe(true)
    expect(runPredicate(calls[0], ['messages', 'conv-1'])).toBe(true)
  })

  it('treats table "*" as invalidate-all (server-side LISTEN resync)', () => {
    const { calls, client } = makeClient()
    const handle = createRealtimeInvalidationHandler(client)

    handle({ event: 'invalidate', data: JSON.stringify({ table: '*', action: 'resync' }) })
    expect(calls).toHaveLength(1)
    expect(runPredicate(calls[0], ['drive'])).toBe(true)
  })

  it('resync invalidate-all still defers messages of a conversation whose staff reply is mid-flight', () => {
    const { calls, client } = makeClient({ mutatingConversationIds: ['conv-busy'] })
    const handle = createRealtimeInvalidationHandler(client)

    handle({ event: 'invalidate', data: JSON.stringify({ table: '*' }) })
    expect(runPredicate(calls[0], ['messages', 'conv-busy'])).toBe(false) // guarded
    expect(runPredicate(calls[0], ['messages', 'conv-idle'])).toBe(true) // refetched
    expect(runPredicate(calls[0], ['conversations'])).toBe(true) // non-messages always refetch
  })

  it('ignores pings, empty payloads, and malformed JSON', () => {
    const { calls, client } = makeClient()
    const handle = createRealtimeInvalidationHandler(client)

    handle({ event: 'ping', data: '' })
    handle({ event: 'invalidate', data: '' })
    handle({ event: 'invalidate', data: 'not-json' })
    handle({ event: 'invalidate', data: JSON.stringify({ id: 'no-table' }) })
    expect(calls).toHaveLength(0)
  })
})

describe('createRealtimeInvalidationHandler — routing', () => {
  it('conversations table invalidates conversations list', () => {
    expect(invalidatedKeys({ table: 'conversations' })).toContainEqual(['conversations'])
  })

  it('conversations with id invalidates conversation detail + messages', () => {
    const keys = invalidatedKeys({ table: 'conversations', id: 'conv-123' })
    expect(keys).toContainEqual(['conversations'])
    expect(keys).toContainEqual(['conversation', 'conv-123'])
    expect(keys).toContainEqual(['messages', 'conv-123'])
  })

  it('conversations defers the messages refetch while a staff reply is mid-flight', () => {
    const keys = invalidatedKeys({ table: 'conversations', id: 'conv-123' }, { mutatingConversationIds: ['conv-123'] })
    expect(keys).toContainEqual(['conversation', 'conv-123'])
    expect(keys).not.toContainEqual(['messages', 'conv-123'])
  })

  it('agent-sessions with id invalidates messages for that conversation', () => {
    const keys = invalidatedKeys({ table: 'agent-sessions', id: 'conv-abc' })
    expect(keys).toContainEqual(['messages', 'conv-abc'])
    expect(keys).toContainEqual(['conversations'])
  })

  it('agent-sessions without id does not broadcast', () => {
    expect(invalidatedKeys({ table: 'agent-sessions' })).not.toContainEqual(['conversations'])
  })

  it('agent-sessions message_update action is suppressed', () => {
    expect(invalidatedKeys({ table: 'agent-sessions', id: 'conv-abc', action: 'message_update' })).toHaveLength(0)
  })

  it('approvals table invalidates approvals list', () => {
    expect(invalidatedKeys({ table: 'approvals' })).toContainEqual(['approvals'])
  })

  it('change_proposals approved for agents invalidates drive', () => {
    const keys = invalidatedKeys({
      table: 'change_proposals',
      action: 'approved',
      resourceModule: 'agents',
      resourceId: 'agent-001',
    })
    expect(keys).toContainEqual(['change_proposals'])
    expect(keys).toContainEqual(['agents'])
    expect(keys).toContainEqual(['agent', 'agent-001'])
    expect(keys).toContainEqual(['drive'])
  })

  it('change_proposals approved for contacts invalidates drive', () => {
    const keys = invalidatedKeys({
      table: 'change_proposals',
      action: 'approved',
      resourceModule: 'contacts',
      resourceId: 'contact-001',
    })
    expect(keys).toContainEqual(['contacts'])
    expect(keys).toContainEqual(['contact', 'contact-001'])
    expect(keys).toContainEqual(['drive'])
  })

  it('change_proposals auto_written for agents invalidates drive', () => {
    const keys = invalidatedKeys({
      table: 'change_proposals',
      action: 'auto_written',
      resourceModule: 'agents',
      resourceId: 'agent-002',
    })
    expect(keys).toContainEqual(['drive'])
  })

  it('change_proposals pending does not invalidate drive', () => {
    const keys = invalidatedKeys({
      table: 'change_proposals',
      action: 'pending',
      resourceModule: 'agents',
      resourceId: 'agent-003',
    })
    expect(keys).not.toContainEqual(['drive'])
  })

  it('change_proposals with conversationId invalidates activity', () => {
    const keys = invalidatedKeys({
      table: 'change_proposals',
      action: 'approved',
      resourceModule: 'agents',
      resourceId: 'agent-001',
      conversationId: 'conv-xyz',
    })
    expect(keys).toContainEqual(['activity', 'conv-xyz'])
  })

  it('agent_staff_memory invalidates drive only', () => {
    expect(invalidatedKeys({ table: 'agent_staff_memory' })).toEqual([['drive']])
  })

  it('agent_definitions invalidates the agents prefix', () => {
    expect(invalidatedKeys({ table: 'agent_definitions' })).toEqual([['agents']])
  })

  it('auth_invitation invalidates the pending-invitations list', () => {
    expect(invalidatedKeys({ table: 'auth_invitation' })).toEqual([['auth_invitation']])
  })

  it('staff_profiles invalidates staff, plus drive on memory updates', () => {
    expect(invalidatedKeys({ table: 'staff_profiles' })).toEqual([['staff']])
    const keys = invalidatedKeys({ table: 'staff_profiles', action: 'memory_updated' })
    expect(keys).toContainEqual(['staff'])
    expect(keys).toContainEqual(['drive'])
  })

  it('learned_skills invalidates drive only', () => {
    expect(invalidatedKeys({ table: 'learned_skills' })).toEqual([['drive']])
  })

  it('drive_files and schema-qualified drive.files invalidate drive', () => {
    expect(invalidatedKeys({ table: 'drive_files' })).toContainEqual(['drive'])
    expect(invalidatedKeys({ table: 'drive.files' })).toContainEqual(['drive'])
  })

  it('automations tables fan out to the dashboard widgets', () => {
    const keys = invalidatedKeys({ table: 'automation_runs' })
    expect(keys).toContainEqual(['system', 'activity', 'runs'])
    expect(keys).toContainEqual(['system', 'activity', 'banner'])
  })

  it('unknown table falls back to the broad key', () => {
    expect(invalidatedKeys({ table: 'some_other_table' })).toEqual([['some_other_table']])
  })
})
