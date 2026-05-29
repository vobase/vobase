/**
 * e2e for `waitForWake` — the blocking primitive behind the
 * `agents debug wake-sync` verb. Seeds synthetic wake rows into
 * `harness.conversation_events` (an append-only journal with no cross-module
 * FK, auto `id`/`ts`) and asserts the status state machine:
 *
 *   - settled    — an `agent_end` exists for the watermarked wake
 *   - no_wake     — no `agent_start` after the watermark
 *   - timeout     — wake started but never ended inside the budget
 *   - watermark   — a wake that started *before* `since` is ignored
 *   - block→settle — the wake ends mid-poll and the loop picks it up
 *
 * Runs the real `createDebugReadersService` against Docker Postgres; each case
 * uses unique conversation/wake ids so they don't interfere (no per-test
 * cleanup needed — the journal is append-only).
 */

import { afterAll, beforeAll, describe, expect, it } from 'bun:test'
import { createDebugReadersService } from '@modules/agents/service/debug-readers'
import { conversationEvents } from '@vobase/core'

import { connectTestDb, resetAndSeedDb, type TestDbHandle } from '../helpers/test-db'

const ORG = 'org-wakesync-e2e'

let dbh: TestDbHandle
let svc: ReturnType<typeof createDebugReadersService>

interface SeedEvent {
  conversationId: string
  wakeId: string
  type: string
  turnIndex?: number
  ts?: Date
  toolName?: string
  toolCalls?: unknown
  payload?: unknown
  costUsd?: string
}

async function seed(ev: SeedEvent): Promise<void> {
  await dbh.db.insert(conversationEvents).values({
    organizationId: ORG,
    conversationId: ev.conversationId,
    wakeId: ev.wakeId,
    turnIndex: ev.turnIndex ?? 0,
    type: ev.type,
    ts: ev.ts ?? new Date(),
    toolName: ev.toolName ?? null,
    toolCalls: ev.toolCalls ?? null,
    payload: ev.payload ?? null,
    costUsd: ev.costUsd ?? null,
  })
}

beforeAll(async () => {
  await resetAndSeedDb()
  dbh = connectTestDb()
  svc = createDebugReadersService({ db: dbh.db })
}, 90_000)

afterAll(async () => {
  if (dbh) await dbh.teardown()
})

describe('waitForWake status state machine', () => {
  it('settles immediately when the wake has already ended', async () => {
    const conversationId = 'conv-settled'
    const wakeId = 'wake-settled'
    const t0 = new Date()
    await seed({
      conversationId,
      wakeId,
      type: 'agent_start',
      turnIndex: 0,
      ts: t0,
      payload: { trigger: 'inbound_message', agentId: 'agent-x' },
    })
    await seed({
      conversationId,
      wakeId,
      type: 'tool_dispatch_started',
      turnIndex: 0,
      ts: new Date(t0.getTime() + 10),
      toolName: 'reply',
    })
    // Args live on tool_execution_start.payload.args — mirror the real harness shape.
    await seed({
      conversationId,
      wakeId,
      type: 'tool_execution_start',
      turnIndex: 0,
      ts: new Date(t0.getTime() + 12),
      toolName: 'reply',
      payload: { args: { text: 'hello there' } },
    })
    await seed({
      conversationId,
      wakeId,
      type: 'agent_end',
      turnIndex: 1,
      ts: new Date(t0.getTime() + 20),
      payload: { reason: 'complete' },
      costUsd: '0.012300',
    })

    const result = await svc.waitForWake({
      organizationId: ORG,
      conversationId,
      since: new Date(t0.getTime() - 5000),
      timeoutMs: 3000,
      pollMs: 250,
    })

    expect(result.status).toBe('settled')
    expect(result.wakeId).toBe(wakeId)
    expect(result.trigger).toBe('inbound_message')
    expect(result.endReason).toBe('complete')
    expect(result.turns).toBe(2) // max(turn_index) + 1
    expect(result.toolCalls).toBe(1)
    expect(result.costUsd).toBeCloseTo(0.0123, 5)
    expect(result.toolCallDetail).toHaveLength(1)
    expect(result.toolCallDetail[0].toolName).toBe('reply')
    expect(result.toolCallDetail[0].argsPreview).toContain('hello there')
  })

  it('returns no_wake when no agent_start appears after the watermark', async () => {
    const result = await svc.waitForWake({
      organizationId: ORG,
      conversationId: 'conv-empty',
      since: new Date(),
      timeoutMs: 700,
      pollMs: 250,
    })
    expect(result.status).toBe('no_wake')
    expect(result.wakeId).toBeNull()
    expect(result.waitedMs).toBeGreaterThanOrEqual(650)
  })

  it('returns timeout when the wake started but never ended', async () => {
    const conversationId = 'conv-timeout'
    const wakeId = 'wake-timeout'
    const t0 = new Date()
    await seed({
      conversationId,
      wakeId,
      type: 'agent_start',
      ts: t0,
      payload: { trigger: 'inbound_message' },
    })

    const result = await svc.waitForWake({
      organizationId: ORG,
      conversationId,
      since: new Date(t0.getTime() - 2000),
      timeoutMs: 700,
      pollMs: 250,
    })
    expect(result.status).toBe('timeout')
    expect(result.wakeId).toBe(wakeId)
    expect(result.endReason).toBeNull()
  })

  it('ignores a wake that started before the watermark (no_wake, not the stale one)', async () => {
    const conversationId = 'conv-watermark'
    const stale = new Date(Date.now() - 60_000)
    await seed({
      conversationId,
      wakeId: 'wake-stale',
      type: 'agent_start',
      ts: stale,
      payload: { trigger: 'inbound_message' },
    })
    await seed({
      conversationId,
      wakeId: 'wake-stale',
      type: 'agent_end',
      ts: new Date(stale.getTime() + 100),
      payload: { reason: 'complete' },
    })

    const result = await svc.waitForWake({
      organizationId: ORG,
      conversationId,
      // Watermark is AFTER the stale wake — it must not be picked up.
      since: new Date(Date.now() - 10_000),
      timeoutMs: 600,
      pollMs: 250,
    })
    expect(result.status).toBe('no_wake')
    expect(result.wakeId).toBeNull()
  })

  it('blocks until a mid-poll agent_end lands, then settles', async () => {
    const conversationId = 'conv-delayed'
    const wakeId = 'wake-delayed'
    const t0 = new Date()
    await seed({
      conversationId,
      wakeId,
      type: 'agent_start',
      ts: t0,
      payload: { trigger: 'inbound_message' },
    })

    // Land the terminal event ~500ms into the wait — the poll loop must keep
    // going and pick it up rather than resolving early or timing out.
    setTimeout(() => {
      void seed({
        conversationId,
        wakeId,
        type: 'agent_end',
        turnIndex: 0,
        ts: new Date(),
        payload: { reason: 'complete' },
      })
    }, 500)

    const result = await svc.waitForWake({
      organizationId: ORG,
      conversationId,
      since: new Date(t0.getTime() - 2000),
      timeoutMs: 5000,
      pollMs: 200,
    })
    expect(result.status).toBe('settled')
    expect(result.wakeId).toBe(wakeId)
    expect(result.endReason).toBe('complete')
    expect(result.waitedMs).toBeGreaterThanOrEqual(400)
  })
})
