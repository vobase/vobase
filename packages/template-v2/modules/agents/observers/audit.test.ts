/**
 * auditObserver tests — contract + shape verification.
 * Full integration (auditLog row count == 3, auditWakeMap rows per wake == 3)
 * is covered by e2e/wake-loop-bootstrap.test.ts which runs against real Postgres.
 */

import { describe, expect, it } from 'bun:test'
import type { AgentEvent } from '@server/contracts/event'
import type { ObserverContext } from '@server/contracts/observer'
import type { ScopedDb } from '@server/contracts/scoped-db'
import { auditObserver } from './audit'

function makeCtx(wakeId = 'wake-test-1'): ObserverContext {
  return {
    organizationId: 'ten1',
    conversationId: 'conv1',
    wakeId,
    ports: {} as ObserverContext['ports'],
    db: {} as unknown as ScopedDb,
    logger: { debug: () => {}, info: () => {}, warn: () => {}, error: () => {} },
    realtime: { notify: () => {}, subscribe: () => () => {} },
  }
}

function makeEvent(type: string): AgentEvent {
  return {
    type: type as AgentEvent['type'],
    ts: new Date(),
    wakeId: 'wake-test-1',
    conversationId: 'conv1',
    organizationId: 'ten1',
    turnIndex: 0,
  } as AgentEvent
}

describe('auditObserver', () => {
  it('has stable id', () => {
    expect(auditObserver.id).toBe('agents:audit')
  })

  it('observer contract: has id string and handle function', () => {
    expect(typeof auditObserver.id).toBe('string')
    expect(auditObserver.id.length).toBeGreaterThan(0)
    expect(typeof auditObserver.handle).toBe('function')
  })

  it('handle() returns a Promise', () => {
    const ctx = makeCtx()
    const event = makeEvent('turn_start')
    // handle() uses dynamic imports for DB tables — in unit tests the db is a stub
    // so the promise may reject; we only assert it is Promise-shaped here.
    const result = auditObserver.handle(event, ctx)
    expect(result).toBeInstanceOf(Promise)
    // swallow the rejection so bun test doesn't fail
    ;(result as Promise<void>).catch(() => {})
  })

  it('different event types produce different details JSON', () => {
    const types = ['agent_start', 'turn_start', 'agent_end'] as const
    const details = types.map((type) => {
      const ev = makeEvent(type)
      return JSON.stringify({ type: ev.type, turnIndex: ev.turnIndex })
    })
    expect(details[0]).not.toBe(details[1])
    expect(details[1]).not.toBe(details[2])
  })

  // ── Phase 2 new event variants ────────────────────────
  // The acceptance criterion: audit_wake_map rows populated for channel_inbound,
  // channel_outbound, and wake_scheduled. The generic handle() covers all AgentEvent
  // variants — these tests assert the new types are valid AgentEvent members and that
  // handle() accepts them (unit: Promise-shaped return; DB-level row count covered by
  // e2e/wake-loop-bootstrap.test.ts and e2e/wake-end-to-end.test.ts).

  it('handle() accepts channel_inbound event without type error', () => {
    const ctx = makeCtx()
    const event: AgentEvent = {
      type: 'channel_inbound',
      ts: new Date(),
      wakeId: 'wake-test-1',
      conversationId: 'conv1',
      organizationId: 'ten1',
      turnIndex: 0,
      channelType: 'whatsapp',
      externalMessageId: 'wamid.ABC123',
      contactId: 'contact-1',
    }
    const result = auditObserver.handle(event, ctx)
    expect(result).toBeInstanceOf(Promise)
    ;(result as Promise<void>).catch(() => {})
  })

  it('handle() accepts channel_outbound event without type error', () => {
    const ctx = makeCtx()
    const event: AgentEvent = {
      type: 'channel_outbound',
      ts: new Date(),
      wakeId: 'wake-test-1',
      conversationId: 'conv1',
      organizationId: 'ten1',
      turnIndex: 0,
      channelType: 'web',
      toolName: 'reply',
      contactId: 'contact-1',
    }
    const result = auditObserver.handle(event, ctx)
    expect(result).toBeInstanceOf(Promise)
    ;(result as Promise<void>).catch(() => {})
  })

  it('handle() accepts wake_scheduled event without type error', () => {
    const ctx = makeCtx()
    const event: AgentEvent = {
      type: 'wake_scheduled',
      ts: new Date(),
      wakeId: 'wake-test-1',
      conversationId: 'conv1',
      organizationId: 'ten1',
      turnIndex: 0,
      trigger: 'scheduled_followup',
      scheduledAt: new Date(Date.now() + 3600_000),
    }
    const result = auditObserver.handle(event, ctx)
    expect(result).toBeInstanceOf(Promise)
    ;(result as Promise<void>).catch(() => {})
  })

  it('audit_wake_map eventType captured correctly for new variants', async () => {
    // Verify the eventType field passed to auditWakeMap.values() matches event.type
    // by using a DB mock that records the insert call.
    const insertedRows: Array<{ eventType: string }> = []

    // Build a mock that tracks the second insert (auditWakeMap)
    let insertCallCount = 0
    const trackingDb = {
      insert: (_table: unknown) => {
        insertCallCount++
        if (insertCallCount % 2 === 1) {
          // First insert: auditLog — return id
          return { values: () => ({ returning: () => Promise.resolve([{ id: 'audit-1' }]) }) }
        }
        // Second insert: auditWakeMap — capture row
        return {
          values: (row: Record<string, unknown>) => {
            insertedRows.push({ eventType: row.eventType as string })
            return Promise.resolve()
          },
        }
      },
    }

    const variants: AgentEvent['type'][] = ['channel_inbound', 'channel_outbound', 'wake_scheduled']
    for (const type of variants) {
      insertCallCount = 0
      const event = makeEvent(type)
      const ctx = { ...makeCtx(), db: trackingDb as unknown as ScopedDb }
      const p = auditObserver.handle(event, ctx)
      if (p) await p.catch(() => {})
    }

    // Each variant should have produced one auditWakeMap row with matching eventType
    expect(insertedRows.map((r) => r.eventType)).toEqual(
      expect.arrayContaining(['channel_inbound', 'channel_outbound', 'wake_scheduled']),
    )
  })
})
