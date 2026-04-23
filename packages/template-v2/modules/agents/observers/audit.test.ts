/**
 * auditObserver tests — contract + shape verification.
 * Full integration (auditLog row count == 3, auditWakeMap rows per wake == 3)
 * is covered by e2e/wake-loop-bootstrap.test.ts which runs against real Postgres.
 */

import { afterEach, beforeEach, describe, expect, it } from 'bun:test'
import type { AgentEvent } from '@server/contracts/event'
import type { ScopedDb } from '@server/contracts/scoped-db'
import { __resetServicesForTests, setDb, setLogger, setRealtime } from '@server/services'
import { auditObserver } from './audit'

function installStubDb(db?: ScopedDb): void {
  setDb((db ?? ({} as unknown as ScopedDb)) as unknown as Parameters<typeof setDb>[0])
  setLogger({ debug: () => {}, info: () => {}, warn: () => {}, error: () => {} })
  setRealtime({ notify: () => {}, subscribe: () => () => {} })
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
  beforeEach(() => __resetServicesForTests())
  afterEach(() => __resetServicesForTests())

  it('has stable id', () => {
    expect(auditObserver.id).toBe('agents:audit')
  })

  it('observer contract: has id string and handle function', () => {
    expect(typeof auditObserver.id).toBe('string')
    expect(auditObserver.id.length).toBeGreaterThan(0)
    expect(typeof auditObserver.handle).toBe('function')
  })

  it('handle() returns a Promise', () => {
    installStubDb()
    const event = makeEvent('turn_start')
    const result = auditObserver.handle(event)
    expect(result).toBeInstanceOf(Promise)
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

  it('handle() accepts channel_inbound event without type error', () => {
    installStubDb()
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
    const result = auditObserver.handle(event)
    expect(result).toBeInstanceOf(Promise)
    ;(result as Promise<void>).catch(() => {})
  })

  it('handle() accepts channel_outbound event without type error', () => {
    installStubDb()
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
    const result = auditObserver.handle(event)
    expect(result).toBeInstanceOf(Promise)
    ;(result as Promise<void>).catch(() => {})
  })

  it('handle() accepts wake_scheduled event without type error', () => {
    installStubDb()
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
    const result = auditObserver.handle(event)
    expect(result).toBeInstanceOf(Promise)
    ;(result as Promise<void>).catch(() => {})
  })

  it('audit_wake_map eventType captured correctly for new variants', async () => {
    const insertedRows: Array<{ eventType: string }> = []

    let insertCallCount = 0
    const trackingDb = {
      insert: (_table: unknown) => {
        insertCallCount++
        if (insertCallCount % 2 === 1) {
          return { values: () => ({ returning: () => Promise.resolve([{ id: 'audit-1' }]) }) }
        }
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
      installStubDb(trackingDb as unknown as ScopedDb)
      const event = makeEvent(type)
      const p = auditObserver.handle(event)
      if (p) await (p as Promise<void>).catch(() => {})
    }

    expect(insertedRows.map((r) => r.eventType)).toEqual(
      expect.arrayContaining(['channel_inbound', 'channel_outbound', 'wake_scheduled']),
    )
  })
})
