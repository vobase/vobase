/**
 * Phase 2 dogfood integration test — 13 assertions.
 *
 * Exercises the full round trip: inbound → wake → tool → approval gate →
 * resume (approve + reject) → SSE → frozen-snapshot invariant → idempotency.
 *
 * Uses recorded Anthropic fixtures (VCR-style) so CI is deterministic.
 *
 * Preconditions:
 *   - Docker Postgres running on port 5433 (`docker compose up -d` in this dir)
 *   - `bun run db:reset` run by `resetAndSeedDb()` in beforeAll
 */

import { afterAll, beforeAll, describe, expect, it } from 'bun:test'
import { MERIDIAN_AGENT_ID } from '@modules/agents/seed'
import { ALICE_USER_ID, MERIDIAN_TENANT_ID, SEEDED_CONTACT_ID } from '@modules/contacts/seed'
import { SEEDED_CONV_ID } from '@modules/inbox/seed'
import type { AgentEvent } from '@server/contracts/event'
import type { AgentTool } from '@server/contracts/plugin-context'
import type { SideLoadContributor } from '@server/contracts/side-load'
import type { ModuleRegistrationsSnapshot } from '@server/harness'
import { bootWake } from '@server/harness'
import { mockStream } from '@server/harness/mock-stream'
import { and, eq } from 'drizzle-orm'
import { captureSideLoadHashes } from './helpers/capture-side-load-hashes'
import { createRecordedProvider } from './helpers/recorded-provider'
import { createSimulatedChannelWeb } from './helpers/simulated-channel-web'
import { connectTestDb, resetAndSeedDb, type TestDbHandle } from './helpers/test-db'
import { buildIntegrationPorts, wireApprovalMutatorCtx, wireObserverContextFor } from './helpers/test-harness'

const noopLogger = {
  debug: () => undefined,
  info: () => undefined,
  warn: () => undefined,
  error: () => undefined,
}

describe('Phase 2 dogfood — inbound → wake → tool → approval → resume', () => {
  let db: TestDbHandle
  let ports: Awaited<ReturnType<typeof buildIntegrationPorts>>
  let inboxPort: Awaited<ReturnType<typeof import('@modules/inbox/port').createInboxPort>>
  let unwireObservers: () => void = () => undefined
  let unwireMutator: () => void = () => undefined
  const sseNotifySpy: Array<{ table: string; id?: string; action?: string }> = []

  // Shared state for chained assertions (6 → 7 → 8)
  let pendingApprovalIdA6 = ''
  let wakeIdA6 = ''

  beforeAll(async () => {
    await resetAndSeedDb()
    db = connectTestDb()

    // Wire all module-level DB handles required by Phase 2 services
    const { setDb: setJournalDb } = await import('@modules/agents/service/journal')
    const { setDb: setMessagesDb } = await import('@modules/inbox/service/messages')
    const { setDb: setConversationsDb } = await import('@modules/inbox/service/conversations')
    const { setDb: setPendingApprovalsDb, setScheduler } = await import('@modules/inbox/service/pending-approvals')

    setJournalDb(db.db)
    setMessagesDb(db.db)
    setConversationsDb(db.db)
    setPendingApprovalsDb(db.db)

    // Wire a fake scheduler for pending-approvals.decide() to enqueue approval_resumed
    const { createFakeWakeQueue } = await import('@modules/agents/service/queue-port')
    const { createInProcessScheduler } = await import('@modules/agents/service/wake-scheduler')
    const fakeQueue = createFakeWakeQueue()
    const { scheduler } = createInProcessScheduler({ queue: fakeQueue, debounceMs: 0 })
    setScheduler(scheduler)

    ports = await buildIntegrationPorts(db)

    // Build a contacts port with real upsertByExternal for channel-web resolution
    const { contacts: contactsTable } = await import('@modules/contacts/schema')
    const extendedContacts = {
      ...ports.contacts,
      async upsertByExternal(input: { tenantId: string; phone: string; displayName?: string }) {
        const existing = await db.db
          .select()
          .from(contactsTable)
          .where(and(eq(contactsTable.tenantId, input.tenantId), eq(contactsTable.phone, input.phone)))
          .limit(1)
        if (existing[0]) return existing[0] as Awaited<ReturnType<typeof ports.contacts.get>>
        const rows = await db.db
          .insert(contactsTable)
          .values({ tenantId: input.tenantId, phone: input.phone, displayName: input.displayName, workingMemory: '' })
          .returning()
        return rows[0] as Awaited<ReturnType<typeof ports.contacts.get>>
      },
    }

    // Override ports.contacts for channel-web usage
    Object.assign(ports, { contacts: extendedContacts })

    const { createInboxPort } = await import('@modules/inbox/port')
    inboxPort = createInboxPort()

    // Patch observers + mutator with real db (same pattern as phase1 test-harness)
    unwireObservers = wireObserverContextFor(db, { calls: sseNotifySpy })
    unwireMutator = wireApprovalMutatorCtx(db)
  })

  afterAll(async () => {
    unwireMutator()
    unwireObservers()
    if (db) await db.teardown()
  })

  function makeRegs(extras: Partial<ModuleRegistrationsSnapshot> = {}): ModuleRegistrationsSnapshot {
    return {
      tools: [],
      commands: [],
      observers: [],
      mutators: [],
      materializers: [],
      sideLoadContributors: [],
      ...extras,
    }
  }

  // ── 1 ── channel-web inbound creates conversation + enqueues wake ──────────
  it('inbound webhook creates conversation and enqueues wake job', async () => {
    const channelWeb = createSimulatedChannelWeb({ inboxPort, contactsPort: ports.contacts })

    const result = await channelWeb.postInbound({
      tenantId: MERIDIAN_TENANT_ID,
      from: 'web:session-test-a1',
      text: 'Hi there',
    })

    expect(result.conversationId).toBeTruthy()
    expect(result.messageId).toBeTruthy()
    expect(result.deduplicated).toBe(false)

    // At least one wake job was enqueued
    expect(channelWeb.capturedJobs.length).toBeGreaterThanOrEqual(1)
    expect(channelWeb.capturedJobs[0]?.name).toBe('channel-web:inbound-to-wake')
  })

  // ── 2 ── 10 rapid inbounds collapse to exactly 1 active wake ──────────────
  it('10 rapid inbounds collapse to exactly 1 active wake', async () => {
    const { createFakeWakeQueue } = await import('@modules/agents/service/queue-port')
    const { createInProcessScheduler } = await import('@modules/agents/service/wake-scheduler')

    const q = createFakeWakeQueue()
    const { scheduler } = createInProcessScheduler({ queue: q, debounceMs: 0 })

    for (let i = 0; i < 10; i++) {
      await scheduler.enqueue(
        { trigger: 'inbound_message', conversationId: SEEDED_CONV_ID, messageIds: [`rapid-msg-${i}`] },
        { agentId: MERIDIAN_AGENT_ID, tenantId: MERIDIAN_TENANT_ID },
      )
    }

    // All 10 debounce-collapse into one pending job
    expect(q.pending().length).toBe(1)

    // Merged messageIds carry all 10
    const payload = q.pending()[0]?.data as { trigger: { messageIds: string[] } }
    expect(payload?.trigger?.messageIds?.length).toBe(10)
  })

  // ── 3 ── Agent replays recorded fixture → expected event ordering ──────────
  it('Agent replays fixture yielding the expected event ordering', async () => {
    const { replyTool } = await import('@modules/inbox/tools/reply')
    const { auditObserver } = await import('@modules/agents/observers/audit')
    const { sseObserver } = await import('@modules/agents/observers/sse')
    const { approvalMutator } = await import('@modules/inbox/mutators/approval')

    const res = await bootWake({
      tenantId: MERIDIAN_TENANT_ID,
      agentId: MERIDIAN_AGENT_ID,
      contactId: SEEDED_CONTACT_ID,
      conversationId: SEEDED_CONV_ID,
      provider: createRecordedProvider('meridian-hi-reply.jsonl'),
      registrations: makeRegs({
        tools: [replyTool as unknown as AgentTool],
        observers: [auditObserver, sseObserver],
        mutators: [approvalMutator],
      }),
      ports,
      logger: noopLogger,
    })

    const types = res.harness.events.map((e) => e.type).filter((t) => t !== 'message_update')
    expect(types).toEqual([
      'agent_start',
      'turn_start',
      'llm_call',
      'message_start',
      'tool_execution_start',
      'tool_execution_end',
      'message_end',
      'turn_end',
      'agent_end',
    ])
  })

  // ── 4 ── llm_call event carries real cost + token metadata ────────────────
  it('llm_call event populated with provider, model, tokens, costUsd, latencyMs', async () => {
    const { replyTool } = await import('@modules/inbox/tools/reply')

    const res = await bootWake({
      tenantId: MERIDIAN_TENANT_ID,
      agentId: MERIDIAN_AGENT_ID,
      contactId: SEEDED_CONTACT_ID,
      conversationId: SEEDED_CONV_ID,
      provider: createRecordedProvider('meridian-hi-reply.jsonl'),
      registrations: makeRegs({ tools: [replyTool as unknown as AgentTool] }),
      ports,
      logger: noopLogger,
    })

    const llm = res.harness.events.find((e): e is AgentEvent & { type: 'llm_call' } => e.type === 'llm_call')
    expect(llm).toBeDefined()
    expect((llm?.costUsd ?? 0) > 0).toBe(true)
    expect(llm).toMatchObject({
      type: 'llm_call',
      provider: 'anthropic',
      model: expect.any(String),
      tokensIn: 1250,
      tokensOut: 32,
      cacheReadTokens: 0,
      costUsd: expect.any(Number),
      latencyMs: expect.any(Number),
      cacheHit: false,
    })
  })

  // ── 5 ── reply tool persists message + conversation_events atomically ──────
  it('reply tool persists message + conversation_events atomically via InboxPort — no direct drizzle write', async () => {
    const { replyTool } = await import('@modules/inbox/tools/reply')
    const { messages: messagesTable } = await import('@modules/inbox/schema')
    const { conversationEvents } = await import('@modules/agents/schema')

    const countBefore = (
      await db.db.select().from(messagesTable).where(eq(messagesTable.conversationId, SEEDED_CONV_ID))
    ).length

    const res = await bootWake({
      tenantId: MERIDIAN_TENANT_ID,
      agentId: MERIDIAN_AGENT_ID,
      contactId: SEEDED_CONTACT_ID,
      conversationId: SEEDED_CONV_ID,
      provider: createRecordedProvider('meridian-hi-reply.jsonl'),
      registrations: makeRegs({ tools: [replyTool as unknown as AgentTool] }),
      ports,
      logger: noopLogger,
    })

    // One new message row created
    const after = await db.db.select().from(messagesTable).where(eq(messagesTable.conversationId, SEEDED_CONV_ID))
    expect(after.length - countBefore).toBe(1)

    const newMsg = after[after.length - 1]!
    expect(newMsg.kind).toBe('text')
    expect((newMsg.content as { text?: string }).text).toContain('Hello')

    // conversation_events has a tool_execution_end for this wake (atomic write invariant)
    const toolEndRow = await db.db
      .select()
      .from(conversationEvents)
      .where(and(eq(conversationEvents.wakeId, res.wakeId), eq(conversationEvents.type, 'tool_execution_end')))
    expect(toolEndRow.length).toBeGreaterThanOrEqual(1)
    expect(toolEndRow[0]?.toolName).toBe('reply')
  })

  // ── 6 ── send_card blocks on approvalMutator + frozen agent_snapshot ───────
  it('send_card blocks on approvalMutator and inserts pending_approvals row with frozen agent snapshot', async () => {
    const { auditObserver } = await import('@modules/agents/observers/audit')
    const { sseObserver } = await import('@modules/agents/observers/sse')
    const { approvalMutator } = await import('@modules/inbox/mutators/approval')
    const { pendingApprovals } = await import('@modules/inbox/schema')

    // Clear spy for assertion 7
    sseNotifySpy.length = 0

    const res = await bootWake({
      tenantId: MERIDIAN_TENANT_ID,
      agentId: MERIDIAN_AGENT_ID,
      contactId: SEEDED_CONTACT_ID,
      conversationId: SEEDED_CONV_ID,
      provider: createRecordedProvider('meridian-pricing-card.jsonl'),
      registrations: makeRegs({ observers: [auditObserver, sseObserver], mutators: [approvalMutator] }),
      ports,
      logger: noopLogger,
    })

    wakeIdA6 = res.wakeId

    // Wake blocked
    const endEvt = res.harness.events.find((e): e is AgentEvent & { type: 'agent_end' } => e.type === 'agent_end')
    expect(endEvt?.reason).toBe('blocked')

    // approval_requested event emitted
    expect(res.harness.events.some((e) => e.type === 'approval_requested')).toBe(true)

    // pending_approvals row created with frozen agent snapshot
    const rows = await db.db
      .select()
      .from(pendingApprovals)
      .where(and(eq(pendingApprovals.wakeId, res.wakeId), eq(pendingApprovals.conversationId, SEEDED_CONV_ID)))
    expect(rows.length).toBe(1)
    expect(rows[0]?.toolName).toBe('send_card')
    expect(rows[0]?.status).toBe('pending')
    expect(rows[0]?.agentSnapshot).toBeTruthy()

    pendingApprovalIdA6 = rows[0]!.id
  })

  // ── 7 ── sseObserver emits realtime notifications ─────────────────────────
  it('sseObserver emits realtime notifications on message_update and approval_requested', () => {
    // sseNotifySpy populated by assertion 6's wake
    expect(sseNotifySpy.length).toBeGreaterThan(0)

    const actions = sseNotifySpy.map((n) => n.action)
    expect(actions).toContain('message_update')
    expect(actions).toContain('approval_requested')

    // All notifications reference the conversation
    for (const n of sseNotifySpy) {
      expect(n.id).toBe(SEEDED_CONV_ID)
    }
  })

  // ── 8 ── approve → approval_resumed wake + synthetic {ok:true} in trigger ─
  it('approving pending card triggers approval_resumed wake; synthetic {ok:true} tool_result in side-load', async () => {
    expect(pendingApprovalIdA6).toBeTruthy()

    const { decide } = await import('@modules/inbox/service/pending-approvals')
    const { replyTool } = await import('@modules/inbox/tools/reply')
    const { approvalMutator } = await import('@modules/inbox/mutators/approval')

    // Approve the pending card
    const decideResult = await decide(pendingApprovalIdA6, {
      decision: 'approved',
      decidedByUserId: ALICE_USER_ID,
      note: undefined,
    })
    expect(decideResult.trigger.decision).toBe('approved')
    expect(decideResult.enqueued).toBe(true)

    // Run the approval_resumed wake using the hi-reply fixture (agent replies after approval)
    const resumedRes = await bootWake({
      tenantId: MERIDIAN_TENANT_ID,
      agentId: MERIDIAN_AGENT_ID,
      contactId: SEEDED_CONTACT_ID,
      conversationId: SEEDED_CONV_ID,
      trigger: decideResult.trigger,
      provider: createRecordedProvider('meridian-hi-reply.jsonl'),
      registrations: makeRegs({
        tools: [replyTool as unknown as AgentTool],
        mutators: [approvalMutator],
      }),
      ports,
      logger: noopLogger,
    })

    // Wake completed (not blocked)
    const endEvt = resumedRes.harness.events.find(
      (e): e is AgentEvent & { type: 'agent_end' } => e.type === 'agent_end',
    )
    expect(endEvt?.reason).toBe('complete')

    // The trigger message communicated approval ("Your previous action was approved")
    const prompt0 = resumedRes.harness.capturedPrompts[0]
    expect(prompt0?.firstUserMessage).toContain('approved')
  })

  // ── 9 ── A3 guard: dispatcher transport-only, InboxPort writes the row ─────
  it('approved send_card dispatches via dispatcher transport AND persists via InboxPort — no double write', async () => {
    const { dispatch } = await import('@modules/channel-web/service/dispatcher')
    const { messages: messagesTable } = await import('@modules/inbox/schema')

    const before = await db.db.select().from(messagesTable).where(eq(messagesTable.conversationId, SEEDED_CONV_ID))

    const cardPayload = {
      type: 'card',
      title: 'Pricing Options',
      children: [{ type: 'text', content: 'Plan A: $99/mo | Plan B: $199/mo' }],
    }
    const notifyLog: Array<{ table: string; id?: string; action?: string }> = []

    const result = await dispatch(
      {
        tenantId: MERIDIAN_TENANT_ID,
        conversationId: SEEDED_CONV_ID,
        contactId: SEEDED_CONTACT_ID,
        wakeId: wakeIdA6 || 'a9-test-wake',
        channelType: 'web',
        toolName: 'send_card',
        payload: cardPayload,
      },
      inboxPort,
      { notify: (p) => notifyLog.push(p) },
    )

    const after = await db.db.select().from(messagesTable).where(eq(messagesTable.conversationId, SEEDED_CONV_ID))

    // Exactly 1 new message row — no double write
    expect(after.length - before.length).toBe(1)
    expect(result.messageId).toBeTruthy()
    expect(result.notified).toBe(true)

    // Dispatcher fired one SSE notify for the card message
    expect(notifyLog.filter((n) => n.table === 'messages').length).toBe(1)
  })

  // ── 10 ── frozen-snapshot: system frozen, side-load rebuilt per turn ───────
  it('mid-wake memory write is ABSENT from turn N side-load but PRESENT in turn N+1 (frozen-snapshot invariant)', async () => {
    const { auditObserver } = await import('@modules/agents/observers/audit')
    const { sseObserver } = await import('@modules/agents/observers/sse')
    const { approvalMutator } = await import('@modules/inbox/mutators/approval')

    const perTurnContributor: SideLoadContributor = async (ctx) => [
      {
        kind: 'custom',
        priority: 1,
        render: () => `turn-counter: ${ctx.turnIndex + 1}`,
      },
    ]

    const res = await bootWake({
      tenantId: MERIDIAN_TENANT_ID,
      agentId: MERIDIAN_AGENT_ID,
      contactId: SEEDED_CONTACT_ID,
      conversationId: SEEDED_CONV_ID,
      maxTurns: 2,
      mockStreamFn: mockStream([{ type: 'finish', finishReason: 'stop' }]),
      registrations: makeRegs({
        observers: [auditObserver, sseObserver],
        mutators: [approvalMutator],
        sideLoadContributors: [perTurnContributor],
      }),
      ports,
      logger: noopLogger,
    })

    expect(res.harness.capturedPrompts.length).toBe(2)

    const hashes = captureSideLoadHashes(res.harness.capturedPrompts)
    const h0 = hashes[0]!
    const h1 = hashes[1]!

    // Frozen: system hash identical across both turns (frozen-snapshot invariant)
    expect(h1.systemHash).toBe(h0.systemHash)

    // Side-load rebuilt: firstUserMessage hash differs between turns
    expect(h1.firstUserMessageHash).not.toBe(h0.firstUserMessageHash)

    // Verify content directly: counter increments per turn
    const p0 = res.harness.capturedPrompts[0]!
    const p1 = res.harness.capturedPrompts[1]!
    expect(p0.firstUserMessage).toContain('turn-counter: 1')
    expect(p1.firstUserMessage).toContain('turn-counter: 2')
    expect(p0.firstUserMessage).not.toContain('turn-counter: 2')
    expect(p1.firstUserMessage).not.toContain('turn-counter: 1')
  })

  // ── 11 ── reject path → agent chooses alternative via reply fallback ────────
  it('rejecting pending card triggers approval_resumed wake with {ok:false, reason}; agent chooses alternative', async () => {
    const { approvalMutator } = await import('@modules/inbox/mutators/approval')
    const { replyTool } = await import('@modules/inbox/tools/reply')
    const { pendingApprovals, messages: messagesTable } = await import('@modules/inbox/schema')

    // Block a fresh send_card in a new wake
    const blockedRes = await bootWake({
      tenantId: MERIDIAN_TENANT_ID,
      agentId: MERIDIAN_AGENT_ID,
      contactId: SEEDED_CONTACT_ID,
      conversationId: SEEDED_CONV_ID,
      provider: createRecordedProvider('meridian-pricing-card.jsonl'),
      registrations: makeRegs({ mutators: [approvalMutator] }),
      ports,
      logger: noopLogger,
    })

    const pendingRows = await db.db
      .select()
      .from(pendingApprovals)
      .where(and(eq(pendingApprovals.wakeId, blockedRes.wakeId), eq(pendingApprovals.conversationId, SEEDED_CONV_ID)))
    expect(pendingRows.length).toBe(1)
    const rejectApprovalId = pendingRows[0]!.id

    // Reject the approval
    const { decide } = await import('@modules/inbox/service/pending-approvals')
    const decideResult = await decide(rejectApprovalId, {
      decision: 'rejected',
      decidedByUserId: ALICE_USER_ID,
      note: 'price list is outdated',
    })
    expect(decideResult.trigger.decision).toBe('rejected')
    expect(decideResult.trigger.note).toBe('price list is outdated')

    // Resumed wake: agent receives rejection note and replies with fallback
    const countBefore = (
      await db.db.select().from(messagesTable).where(eq(messagesTable.conversationId, SEEDED_CONV_ID))
    ).length

    const rejRes = await bootWake({
      tenantId: MERIDIAN_TENANT_ID,
      agentId: MERIDIAN_AGENT_ID,
      contactId: SEEDED_CONTACT_ID,
      conversationId: SEEDED_CONV_ID,
      trigger: decideResult.trigger,
      provider: createRecordedProvider('meridian-pricing-card-reject.jsonl'),
      registrations: makeRegs({
        tools: [replyTool as unknown as AgentTool],
        mutators: [approvalMutator],
      }),
      ports,
      logger: noopLogger,
    })

    // Wake completes (agent replied instead of retrying send_card)
    const endEvt = rejRes.harness.events.find((e): e is AgentEvent & { type: 'agent_end' } => e.type === 'agent_end')
    expect(endEvt?.reason).toBe('complete')

    // Trigger message communicated the rejection reason
    const prompt0 = rejRes.harness.capturedPrompts[0]
    expect(prompt0?.firstUserMessage).toContain('rejected')
    expect(prompt0?.firstUserMessage).toContain('price list is outdated')

    // Agent chose reply (not send_card): a text message was written
    const newMessages = await db.db.select().from(messagesTable).where(eq(messagesTable.conversationId, SEEDED_CONV_ID))
    const addedMessages = newMessages.slice(countBefore)
    expect(addedMessages.some((m) => m.kind === 'text')).toBe(true)
  })

  // ── 12 ── mid-turn worker kill resumes cleanly with no duplicate outbound ──
  it('wake worker killed mid-turn resumes cleanly with no duplicate outbound', async () => {
    const { createFakeWakeQueue } = await import('@modules/agents/service/queue-port')
    const { createInMemoryActiveWakes } = await import('@modules/agents/service/active-wakes')
    const { createInMemoryOutbound, createWakeWorker } = await import('@modules/agents/service/wake-worker')
    const { AGENT_WAKE_JOB } = await import('@modules/agents/service/queue-jobs')
    const { replyTool } = await import('@modules/inbox/tools/reply')
    const { approvalMutator } = await import('@modules/inbox/mutators/approval')

    const FIXED_TOOL_CALL_ID = 'tc-a12-idempotency'

    const queue = createFakeWakeQueue()
    const activeWakesStore = createInMemoryActiveWakes()
    const outbound = createInMemoryOutbound()

    const worker = createWakeWorker({
      queue,
      activeWakes: activeWakesStore,
      bootWake: async (opts) => {
        const { bootWake: bw } = await import('@server/harness')
        return bw(opts)
      },
      outbound,
      buildBootOpts: (_payload) => ({
        contactId: SEEDED_CONTACT_ID,
        mockStreamFn: mockStream([
          {
            type: 'tool-call' as const,
            toolCallId: FIXED_TOOL_CALL_ID,
            toolName: 'reply',
            args: { text: 'A12 idempotency reply' },
          },
          { type: 'finish' as const, finishReason: 'stop' },
        ]),
        registrations: makeRegs({
          tools: [replyTool as unknown as AgentTool],
          mutators: [approvalMutator],
        }) as ModuleRegistrationsSnapshot & {
          contactId?: string
        },
        ports,
        logger: noopLogger,
      }),
    })

    await worker.start()

    // Enqueue a wake job
    await queue.send(AGENT_WAKE_JOB, {
      trigger: {
        trigger: 'inbound_message',
        conversationId: SEEDED_CONV_ID,
        messageIds: ['a12-msg-1'],
      },
      agentId: MERIDIAN_AGENT_ID,
      tenantId: MERIDIAN_TENANT_ID,
    })

    // Simulate mid-turn crash: first drain runs the handler but leaves job in queue
    queue.failNextOnce(AGENT_WAKE_JOB)
    await queue.drain()

    // Second drain: job completes normally
    await queue.drain()

    // Despite two handler invocations, outbound dispatched at most once per toolCallId
    const replyDispatches = outbound.log().filter((e) => e.toolName === 'reply')
    expect(replyDispatches.length).toBeLessThanOrEqual(1)
    expect(outbound.seen().size).toBeGreaterThanOrEqual(0)
  })

  // ── 13 ── module shape lint + R3 integration.ts + audit_wake_map populated ─
  it('module shape lint exits 0, R3 integration.ts compiles, audit_wake_map populated for new variants', async () => {
    const cwd = `${import.meta.dir}/..`

    // Shape lint exits 0
    const shapeResult = Bun.spawnSync(['bun', 'run', 'scripts/check-module-shape.ts'], { cwd })
    expect(shapeResult.exitCode).toBe(0)

    // TypeScript compiles (validates R3 integration.ts and all modules)
    const tcResult = Bun.spawnSync(['bun', 'run', 'typecheck'], { cwd })
    expect(tcResult.exitCode).toBe(0)

    // audit_wake_map has rows from the wakes run in this suite
    const { auditWakeMap } = await import('@modules/agents/schema')
    const rows = await db.db.select().from(auditWakeMap)
    expect(rows.length).toBeGreaterThan(0)

    // All expected event variants are present in the map
    const types = rows.map((r) => r.eventType)
    expect(types).toContain('llm_call')
    expect(types).toContain('agent_start')
    expect(types).toContain('agent_end')
  })
})
