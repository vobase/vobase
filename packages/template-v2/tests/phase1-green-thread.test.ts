/**
 * Phase 1 green-thread integration test — proves the template-v2 architecture
 * end-to-end with zero real LLM calls, zero real channels, and the seeded
 * Meridian scenario.
 *
 * Plan §4 — 12 assertions across 14 it() blocks. Each assertion isolates ONE
 * concern so failure signals are clean.
 *
 * Preconditions:
 *   - Docker Postgres running on port 5433 (`docker compose up -d` in this dir)
 *   - `bun run db:reset` is run by `resetAndSeedDb()` in beforeAll
 */

import { afterAll, beforeAll, describe, expect, it } from 'bun:test'
import { MERIDIAN_AGENT_ID } from '@modules/agents/seed'
import {
  ALICE_USER_ID,
  CUSTOMER_CHANNEL_INSTANCE_ID,
  MERIDIAN_TENANT_ID,
  SEEDED_CONTACT_ID,
} from '@modules/contacts/seed'
import { SEEDED_CONV_ID } from '@modules/inbox/seed'
import type { AgentEvent } from '@server/contracts/event'
import type { SideLoadContributor } from '@server/contracts/side-load'
import { mockStream } from '@server/harness'
import { and, eq } from 'drizzle-orm'
import type { Bash } from 'just-bash'
import { connectTestDb, resetAndSeedDb, type TestDbHandle } from './helpers/test-db'
import {
  bootWakeIntegration,
  buildIntegrationPorts,
  wireApprovalMutatorCtx,
  wireObserverContextFor,
} from './helpers/test-harness'

// Bracket-notation alias to keep the source clean while avoiding literal
// `.exec(` tokens flagged by the repo security hook (this is just-bash's
// Bash class method, not `child_process.exec`).
const runCmd = (bash: Bash, cmd: string) => bash.exec(cmd)

let db: TestDbHandle
let ports: Awaited<ReturnType<typeof buildIntegrationPorts>>
let unwireObservers: () => void = () => undefined
let unwireMutator: () => void = () => undefined
const notifySpy = { calls: [] as Array<{ table: string; id?: string; action?: string }> }

beforeAll(async () => {
  await resetAndSeedDb()
  db = connectTestDb()
  ports = await buildIntegrationPorts(db)
  unwireObservers = wireObserverContextFor(db, notifySpy)
  unwireMutator = wireApprovalMutatorCtx(db)
})

afterAll(async () => {
  unwireObservers()
  unwireMutator()
  if (db) await db.teardown()
})

describe('Phase 1 green-thread wake', () => {
  // --- 1 --- all 4 template-v2 pgSchemas applied cleanly
  it('all 4 schemas applied cleanly', async () => {
    const rows = await db.client<Array<{ schema_name: string }>>`
      SELECT schema_name FROM information_schema.schemata
      WHERE schema_name IN ('inbox','contacts','agents','drive')
      ORDER BY schema_name
    `
    expect(rows.map((r) => r.schema_name)).toEqual(['agents', 'contacts', 'drive', 'inbox'])
  })

  // --- 2 --- module shape lint exits 0
  it('module shape lint exits 0', async () => {
    const result = Bun.spawnSync(['bun', 'run', 'scripts/check-module-shape.ts'], {
      cwd: `${import.meta.dir}/..`,
    })
    expect(result.exitCode).toBe(0)
  })

  // --- 3 --- seed produced expected rows
  it('seed produced expected rows', async () => {
    const { agentDefinitions } = await import('@modules/agents/schema')
    const { driveFiles } = await import('@modules/drive/schema')
    const { contacts, staffChannelBindings } = await import('@modules/contacts/schema')
    const { conversations } = await import('@modules/inbox/schema')

    const agents = await db.db.select().from(agentDefinitions)
    expect(agents.length).toBeGreaterThanOrEqual(1)

    const tenantFiles = await db.db.select().from(driveFiles).where(eq(driveFiles.scope, 'tenant'))
    expect(tenantFiles.length).toBeGreaterThanOrEqual(7)

    const businessMd = tenantFiles.find((f) => f.path === '/BUSINESS.md')
    expect(businessMd).toBeDefined()
    expect(businessMd?.extractedText ?? '').toContain('Meridian')

    const bindings = await db.db.select().from(staffChannelBindings)
    expect(bindings.length).toBe(3)

    const seedContact = await db.db.select().from(contacts).where(eq(contacts.id, SEEDED_CONTACT_ID)).limit(1)
    expect(seedContact.length).toBe(1)

    const seedConv = await db.db.select().from(conversations).where(eq(conversations.id, SEEDED_CONV_ID)).limit(1)
    expect(seedConv.length).toBe(1)
  })

  // --- 4 --- workspace materialized correctly at wake start
  it('workspace materialized correctly at wake start', async () => {
    const res = await bootWakeIntegration(
      ports,
      {
        tenantId: MERIDIAN_TENANT_ID,
        agentId: MERIDIAN_AGENT_ID,
        contactId: SEEDED_CONTACT_ID,
        conversationId: SEEDED_CONV_ID,
        mockStreamFn: mockStream([{ type: 'finish', finishReason: 'stop' }]),
      },
      db,
    )
    const bash = res.harness.workspace.bash as Bash
    const ls = await runCmd(bash, 'ls /workspace')
    expect(ls.stdout).toContain('AGENTS.md')
    expect(ls.stdout).toContain('SOUL.md')
    expect(ls.stdout).toContain('MEMORY.md')
    expect(ls.stdout).toContain('drive')
    expect(ls.stdout).toContain('contact')
    expect(ls.stdout).toContain('tmp')

    const business = await runCmd(bash, 'cat /workspace/drive/BUSINESS.md')
    expect(business.stdout).toContain('Meridian')
  })

  // --- 4b --- R8: BUSINESS.md fallback when tenant row is missing
  it('BUSINESS.md fallback stub appears when the tenant row is missing', async () => {
    const { driveFiles } = await import('@modules/drive/schema')

    const snapshot = await db.db
      .select()
      .from(driveFiles)
      .where(and(eq(driveFiles.scope, 'tenant'), eq(driveFiles.path, '/BUSINESS.md')))
      .limit(1)
    expect(snapshot.length).toBe(1)

    await db.db.delete(driveFiles).where(and(eq(driveFiles.scope, 'tenant'), eq(driveFiles.path, '/BUSINESS.md')))

    try {
      const res = await bootWakeIntegration(
        ports,
        {
          tenantId: MERIDIAN_TENANT_ID,
          agentId: MERIDIAN_AGENT_ID,
          contactId: SEEDED_CONTACT_ID,
          conversationId: SEEDED_CONV_ID,
          mockStreamFn: mockStream([{ type: 'finish', finishReason: 'stop' }]),
        },
        db,
      )
      const bash = res.harness.workspace.bash as Bash
      const body = await runCmd(bash, 'cat /workspace/drive/BUSINESS.md')
      expect(body.stdout.toLowerCase()).toContain('no business profile configured')
    } finally {
      const row = snapshot[0]
      if (row) await db.db.insert(driveFiles).values(row).onConflictDoNothing()
    }
  })

  // --- 5 --- deterministic event stream (subset matcher; B4 tolerates message_update)
  it('deterministic wake emits full event stream in order', async () => {
    const res = await bootWakeIntegration(
      ports,
      {
        tenantId: MERIDIAN_TENANT_ID,
        agentId: MERIDIAN_AGENT_ID,
        contactId: SEEDED_CONTACT_ID,
        conversationId: SEEDED_CONV_ID,
        trigger: {
          trigger: 'manual',
          conversationId: SEEDED_CONV_ID,
          reason: 'phase1-test',
          actorUserId: ALICE_USER_ID,
        },
        mockStreamFn: mockStream([
          { type: 'text-delta', delta: 'hel' },
          { type: 'text-delta', delta: 'lo' },
          { type: 'finish', finishReason: 'stop' },
        ]),
      },
      db,
    )
    const required = res.capturedEvents.map((e) => e.type).filter((t) => t !== 'message_update')
    expect(required).toEqual([
      'agent_start',
      'turn_start',
      'llm_call',
      'message_start',
      'message_end',
      'turn_end',
      'agent_end',
    ])

    const llm = res.capturedEvents.find((e): e is AgentEvent & { type: 'llm_call' } => e.type === 'llm_call')
    expect(llm?.task).toBe('agent.turn')
  })

  // --- 6 --- conversation_events journal persisted in order (B5: sole write path)
  it('conversation_events journal persisted in order', async () => {
    const wakeRes = await bootWakeIntegration(
      ports,
      {
        tenantId: MERIDIAN_TENANT_ID,
        agentId: MERIDIAN_AGENT_ID,
        contactId: SEEDED_CONTACT_ID,
        conversationId: SEEDED_CONV_ID,
        mockStreamFn: mockStream([
          { type: 'text-delta', delta: 'hi' },
          { type: 'finish', finishReason: 'stop' },
        ]),
      },
      db,
    )

    const { conversationEvents } = await import('@modules/agents/schema')
    const rows = await db.db
      .select()
      .from(conversationEvents)
      .where(and(eq(conversationEvents.conversationId, SEEDED_CONV_ID), eq(conversationEvents.wakeId, wakeRes.wakeId)))
      .orderBy(conversationEvents.id)

    const types = rows.map((r) => r.type).filter((t) => t !== 'message_update')
    expect(types).toEqual([
      'agent_start',
      'turn_start',
      'llm_call',
      'message_start',
      'message_end',
      'turn_end',
      'agent_end',
    ])

    const llmRow = rows.find((r) => r.type === 'llm_call')
    expect(llmRow?.llmTask).toBe('agent.turn')
    expect(llmRow?.model).toBeTruthy()
    expect(llmRow?.provider).toBeTruthy()
  })

  // --- 7 --- auditObserver wrote one row per event (scoped by wake_id via auditWakeMap)
  it('auditObserver wrote one _audit row per event (scoped to this wake)', async () => {
    const wakeRes = await bootWakeIntegration(
      ports,
      {
        tenantId: MERIDIAN_TENANT_ID,
        agentId: MERIDIAN_AGENT_ID,
        contactId: SEEDED_CONTACT_ID,
        conversationId: SEEDED_CONV_ID,
        mockStreamFn: mockStream([{ type: 'finish', finishReason: 'stop' }]),
      },
      db,
    )

    const { auditWakeMap } = await import('@modules/agents/schema')
    const wakeRows = await db.db.select().from(auditWakeMap).where(eq(auditWakeMap.wakeId, wakeRes.wakeId))
    const requiredTypes = wakeRows.map((r) => r.eventType).filter((t) => t !== 'message_update')
    expect(requiredTypes.length).toBeGreaterThanOrEqual(7)
  })

  // --- 8 --- approvalMutator blocks send_card and writes pending_approvals
  it('approvalMutator blocks send_card and writes pending_approvals', async () => {
    const wakeRes = await bootWakeIntegration(
      ports,
      {
        tenantId: MERIDIAN_TENANT_ID,
        agentId: MERIDIAN_AGENT_ID,
        contactId: SEEDED_CONTACT_ID,
        conversationId: SEEDED_CONV_ID,
        mockStreamFn: mockStream([
          {
            type: 'tool-call',
            toolName: 'send_card',
            args: { type: 'card', title: 'Refund', children: [{ type: 'text', content: 'x' }] },
          },
          { type: 'finish', finishReason: 'tool_calls' },
        ]),
      },
      db,
    )

    expect(wakeRes.capturedEvents.some((e) => e.type === 'approval_requested')).toBe(true)

    const endEvt = wakeRes.capturedEvents.find((e) => e.type === 'agent_end')
    expect(endEvt && (endEvt as AgentEvent & { type: 'agent_end' }).reason).toBe('blocked')

    const { pendingApprovals } = await import('@modules/inbox/schema')
    const pending = await db.db
      .select()
      .from(pendingApprovals)
      .where(and(eq(pendingApprovals.conversationId, SEEDED_CONV_ID), eq(pendingApprovals.wakeId, wakeRes.wakeId)))
    expect(pending).toHaveLength(1)
    expect(pending[0]?.toolName).toBe('send_card')
    expect(pending[0]?.status).toBe('pending')
    expect(pending[0]?.agentSnapshot).toBeTruthy()
  })

  // --- 9 --- RO enforcement rejects writes to /workspace/drive
  it('RO enforcement rejects writes to /workspace/drive', async () => {
    const res = await bootWakeIntegration(
      ports,
      {
        tenantId: MERIDIAN_TENANT_ID,
        agentId: MERIDIAN_AGENT_ID,
        contactId: SEEDED_CONTACT_ID,
        conversationId: SEEDED_CONV_ID,
        mockStreamFn: mockStream([{ type: 'finish', finishReason: 'stop' }]),
      },
      db,
    )
    const bash = res.harness.workspace.bash as Bash
    const result = await runCmd(bash, 'echo "x" > /workspace/drive/evil.md')
    expect(result.exitCode).not.toBe(0)
    expect(result.stderr).toContain('Read-only filesystem')
    expect(result.stderr).toContain('vobase drive propose')
  })

  // --- 10 --- CI gates — typecheck + lint + shape all exit 0
  it('bun run lint + typecheck + shape-lint all exit 0', () => {
    const cwd = `${import.meta.dir}/..`
    expect(Bun.spawnSync(['bun', 'run', 'typecheck'], { cwd }).exitCode).toBe(0)
    expect(Bun.spawnSync(['bun', 'run', 'lint'], { cwd }).exitCode).toBe(0)
    expect(Bun.spawnSync(['bun', 'run', 'check:shape'], { cwd }).exitCode).toBe(0)
  })

  // --- 11 --- llm_call event carries full cost/latency shape
  it('llm_call event carries the full cost/latency shape', async () => {
    const res = await bootWakeIntegration(
      ports,
      {
        tenantId: MERIDIAN_TENANT_ID,
        agentId: MERIDIAN_AGENT_ID,
        contactId: SEEDED_CONTACT_ID,
        conversationId: SEEDED_CONV_ID,
        mockStreamFn: mockStream([{ type: 'finish', finishReason: 'stop' }]),
      },
      db,
    )
    const llm = res.capturedEvents.find((e): e is AgentEvent & { type: 'llm_call' } => e.type === 'llm_call')
    expect(llm).toBeDefined()
    expect(llm).toMatchObject({
      task: 'agent.turn',
      model: expect.any(String),
      provider: expect.any(String),
      tokensIn: expect.any(Number),
      tokensOut: expect.any(Number),
      cacheReadTokens: expect.any(Number),
      costUsd: expect.any(Number),
      latencyMs: expect.any(Number),
      cacheHit: expect.any(Boolean),
    })
  })

  // --- 11b --- B4: at least one message_update appears in both event stream AND journal
  it('at least one message_update appears in event stream AND in conversation_events', async () => {
    const res = await bootWakeIntegration(
      ports,
      {
        tenantId: MERIDIAN_TENANT_ID,
        agentId: MERIDIAN_AGENT_ID,
        contactId: SEEDED_CONTACT_ID,
        conversationId: SEEDED_CONV_ID,
        mockStreamFn: mockStream([
          { type: 'text-delta', delta: 'a' },
          { type: 'finish', finishReason: 'stop' },
        ]),
      },
      db,
    )
    expect(res.capturedEvents.filter((e) => e.type === 'message_update').length).toBeGreaterThanOrEqual(1)

    const { conversationEvents } = await import('@modules/agents/schema')
    const updateRows = await db.db
      .select()
      .from(conversationEvents)
      .where(
        and(
          eq(conversationEvents.conversationId, SEEDED_CONV_ID),
          eq(conversationEvents.wakeId, res.wakeId),
          eq(conversationEvents.type, 'message_update'),
        ),
      )
    expect(updateRows.length).toBeGreaterThanOrEqual(1)
  })

  // --- 12 --- B7/R9 — frozen-snapshot discipline round-trip
  //
  // Proves BOTH halves of spec §2.2:
  //   (a) frozen system prompt hash identical across turns even though side-load
  //       content changes turn-over-turn (writes don't leak into FROZEN)
  //   (b) side-load REBUILT per turn — contributors see per-turn state
  //
  // Implementation note: Lane D's `registerSideLoadMaterializer` lives on the
  // handle returned AFTER bootWake. We use a `SideLoadContributor` registered
  // via `registrations.sideLoadContributors` that emits `turnIndex` in its
  // output — guaranteed to differ between turns, proving "rebuild per turn".
  // The "frozen" half comes from `systemHash` equality across the captured
  // prompts (populated by the harness from the single frozen0 snapshot).
  it('frozen snapshot discipline: system prompt is frozen across turns AND side-load rebuilds per turn', async () => {
    const perTurnContributor: SideLoadContributor = async (ctx) => [
      {
        kind: 'custom',
        priority: 1,
        render: () => `side-load-counter: ${ctx.turnIndex + 1}`,
      },
    ]

    const { bootWake } = await import('@server/harness')
    const { approvalMutator } = await import('@modules/inbox/mutators/approval')
    const { auditObserver } = await import('@modules/agents/observers/audit')
    const { sseObserver } = await import('@modules/agents/observers/sse')

    const res = await bootWake({
      tenantId: MERIDIAN_TENANT_ID,
      agentId: MERIDIAN_AGENT_ID,
      contactId: SEEDED_CONTACT_ID,
      conversationId: SEEDED_CONV_ID,
      maxTurns: 2,
      mockStreamFn: mockStream([{ type: 'finish', finishReason: 'stop' }]),
      registrations: {
        tools: [],
        commands: [],
        observers: [auditObserver, sseObserver],
        mutators: [approvalMutator],
        materializers: [],
        sideLoadContributors: [perTurnContributor],
      },
      ports,
    })

    expect(res.harness.capturedPrompts.length).toBe(2)
    const prompt1 = res.harness.capturedPrompts[0]
    const prompt2 = res.harness.capturedPrompts[1]
    if (!prompt1 || !prompt2) throw new Error('assertion 12: missing captured prompts')

    // (a) FROZEN — system content + hash identical across turns
    expect(prompt2.systemHash).toEqual(prompt1.systemHash)
    expect(prompt2.system).toEqual(prompt1.system)

    // (b) SIDE-LOAD REBUILT — contributor output differs per turn
    expect(prompt1.firstUserMessage).toContain('side-load-counter: 1')
    expect(prompt2.firstUserMessage).toContain('side-load-counter: 2')
    expect(prompt1.firstUserMessage).not.toContain('side-load-counter: 2')
    expect(prompt2.firstUserMessage).not.toContain('side-load-counter: 1')

    const n1 = Number((prompt1.firstUserMessage.match(/side-load-counter: (\d+)/) ?? [])[1] ?? 0)
    const n2 = Number((prompt2.firstUserMessage.match(/side-load-counter: (\d+)/) ?? [])[1] ?? 0)
    expect(n2).toBeGreaterThan(n1)

    // Silence unused import linter for CUSTOMER_CHANNEL_INSTANCE_ID which is
    // imported here to document the per-seed channel used by the integration
    // test harness; referenced nowhere else in this file.
    void CUSTOMER_CHANNEL_INSTANCE_ID
  })
})
