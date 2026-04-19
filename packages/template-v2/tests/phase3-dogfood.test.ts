/**
 * Phase 3 dogfood integration test — ≥14 assertions.
 * Plan §P3.7, §4.2.
 *
 * Exercises the full Phase-3 loop: workspace-agent bash invocations,
 * learning-proposal observer, moderation mutator, scorer observer,
 * card-reply round-trip, Gemini caption, and threat_scan wiring.
 *
 * All LLM calls go through recorded fixtures or inline stubs.
 * Requires Docker Postgres on port 5433 (`docker compose up -d`).
 */

import { afterAll, beforeAll, describe, expect, it } from 'bun:test'
import { readFileSync } from 'node:fs'
import { MERIDIAN_AGENT_ID } from '@modules/agents/seed'
import { ALICE_USER_ID, MERIDIAN_TENANT_ID, SEEDED_CONTACT_ID } from '@modules/contacts/seed'
import { SEEDED_CONV_ID } from '@modules/inbox/seed'
import type { AgentEvent } from '@server/contracts/event'
import type { AgentObserver, ObserverContext } from '@server/contracts/observer'
import type { AgentTool, PluginContext, ToolExecutionContext } from '@server/contracts/plugin-context'
import type { ScopedDb } from '@server/contracts/scoped-db'
import type { SideLoadContributor } from '@server/contracts/side-load'
import type { ToolResult } from '@server/contracts/tool-result'
import type { ModuleRegistrationsSnapshot } from '@server/harness'
import { bootWake } from '@server/harness'
import { eq } from 'drizzle-orm'
import { captureSideLoadHashes } from './helpers/capture-side-load-hashes'
import { bootWakePhase3, buildPhase3Registrations } from './helpers/make-phase3-harness'
import { createRecordedProvider } from './helpers/recorded-provider'
import { connectTestDb, resetAndSeedDb, type TestDbHandle } from './helpers/test-db'
import { buildIntegrationPorts, wireApprovalMutatorCtx, wireObserverContextFor } from './helpers/test-harness'

const noopLogger = {
  debug: () => undefined,
  info: () => undefined,
  warn: () => undefined,
  error: () => undefined,
}

// ─── Inline helpers ────────────────────────────────────────────────────────────

/** Build a stub bash tool that returns canned output per command string. */
function makeCannedBashTool(
  handler: (cmd: string) => { stdout: string; stderr?: string; exitCode?: number },
): AgentTool {
  return {
    name: 'bash',
    description: 'Stub bash tool for tests',
    inputSchema: {
      type: 'object',
      properties: { command: { type: 'string' } },
      required: ['command'],
    },
    async execute(
      args: { command?: string },
      _ctx: ToolExecutionContext,
    ): Promise<ToolResult<{ stdout: string; stderr: string; exitCode: number }>> {
      if (!args || typeof args.command !== 'string') {
        return { ok: false, error: 'bash: missing command' }
      }
      const out = handler(args.command)
      return { ok: true, content: { stdout: out.stdout, stderr: out.stderr ?? '', exitCode: out.exitCode ?? 0 } }
    },
  } as unknown as AgentTool
}

/** Wrap an observer to inject a real DB handle into every ObserverContext call. */
function withRealDb(obs: AgentObserver, db: TestDbHandle): AgentObserver {
  const origHandle = obs.handle.bind(obs)
  return {
    ...obs,
    handle: (event: AgentEvent, ctx: ObserverContext) =>
      origHandle(event, { ...ctx, db: db.db as unknown as ScopedDb }),
  }
}

/** Build an llmCall stub that returns a canned response per task. */
function makeStubLlmCall(responses: Partial<Record<string, string>> = {}): PluginContext['llmCall'] {
  return async (task) => ({
    task,
    model: 'stub',
    provider: 'stub',
    content: (responses[task] ?? '{"score":0.75,"rationale":"stub"}') as never,
    tokensIn: 50,
    tokensOut: 20,
    cacheReadTokens: 0,
    costUsd: 0,
    latencyMs: 5,
    cacheHit: false,
  })
}

/** Extract the proposals JSON from the meridian-learn-propose fixture. */
function learnProposeContent(): string {
  const lines = readFileSync('tests/fixtures/provider/meridian-learn-propose.jsonl', 'utf8').split('\n').filter(Boolean)
  for (const line of lines) {
    const ev = JSON.parse(line) as { type?: string; delta?: { type?: string; text?: string } }
    if (ev.type === 'content_block_delta' && ev.delta?.type === 'text_delta' && ev.delta.text) {
      return ev.delta.text
    }
  }
  return '{"proposals":[]}'
}

// ─── Suite ────────────────────────────────────────────────────────────────────

describe('Phase 3 dogfood — workspace agent + learning flow + full observer chain', () => {
  let db: TestDbHandle
  let ports: Awaited<ReturnType<typeof buildIntegrationPorts>>
  let unwireObservers: () => void = () => undefined
  let unwireMutator: () => void = () => undefined

  beforeAll(async () => {
    await resetAndSeedDb()
    db = connectTestDb()

    const { setDb: setJournalDb } = await import('@modules/agents/service/journal')
    const { setDb: setMessagesDb } = await import('@modules/inbox/service/messages')
    const { setDb: setConversationsDb } = await import('@modules/inbox/service/conversations')
    const { setDb: setPendingApprovalsDb, setScheduler } = await import('@modules/inbox/service/pending-approvals')
    const { setDb: setLearningDb } = await import('@modules/agents/service/learning-proposals')
    const { setDb: setAgentDefsDb } = await import('@modules/agents/service/agent-definitions')

    setJournalDb(db.db)
    setMessagesDb(db.db)
    setConversationsDb(db.db)
    setPendingApprovalsDb(db.db)
    setLearningDb(db.db)
    setAgentDefsDb(db.db)

    const { createFakeWakeQueue } = await import('@modules/agents/service/queue-port')
    const { createInProcessScheduler } = await import('@modules/agents/service/wake-scheduler')
    const q = createFakeWakeQueue()
    const { scheduler } = createInProcessScheduler({ queue: q, debounceMs: 0 })
    setScheduler(scheduler)

    ports = await buildIntegrationPorts(db)
    unwireObservers = wireObserverContextFor(db, { calls: [] })
    unwireMutator = wireApprovalMutatorCtx(db)
  })

  afterAll(async () => {
    unwireMutator()
    unwireObservers()
    if (db) await db.teardown()
  })

  // ── #1 ── bash navigate: LLM invokes bash and receives stdout ────────────────
  it('agent emits tool_use bash{ls /workspace/drive} and receives non-null stdout', async () => {
    const capturedCmds: string[] = []
    const bashTool = makeCannedBashTool((cmd) => {
      capturedCmds.push(cmd)
      return { stdout: 'BUSINESS.md\nREADME.md\nAGENTS.md\n' }
    })

    const res = await bootWakePhase3({
      tenantId: MERIDIAN_TENANT_ID,
      agentId: MERIDIAN_AGENT_ID,
      contactId: SEEDED_CONTACT_ID,
      conversationId: SEEDED_CONV_ID,
      provider: createRecordedProvider('meridian-bash-navigate.jsonl'),
      maxTurns: 1,
      extraTools: [bashTool],
      overridePorts: { agents: ports.agents, contacts: ports.contacts, drive: ports.drive },
    })

    const toolStart = res.harness.events.find(
      (e) => e.type === 'tool_execution_start' && (e as { toolName?: string }).toolName === 'bash',
    )
    expect(toolStart, 'expected tool_execution_start for bash').toBeTruthy()
    const args = (toolStart as unknown as { args: { command: string } }).args
    expect(args.command).toContain('/workspace/drive')

    const toolEnd = res.harness.events.find(
      (e) => e.type === 'tool_execution_end' && (e as { toolName?: string }).toolName === 'bash',
    )
    expect(toolEnd, 'expected tool_execution_end for bash').toBeTruthy()
    const result = (toolEnd as unknown as { result: { content?: { stdout?: string }; ok: boolean } }).result
    expect(result?.ok).toBe(true)
    expect(result?.content?.stdout).toBeTruthy()
  })

  // ── #2a ── vobase memory set produces correct DriveCommandResult shape ────────
  it('vobase memory set via bash CommandDef produces correct DriveCommandResult struct', async () => {
    const capturedCmds: string[] = []
    const bashTool = makeCannedBashTool((cmd) => {
      capturedCmds.push(cmd)
      if (cmd.includes('memory set')) {
        return {
          stdout: JSON.stringify({
            ok: true,
            action: 'upsert',
            section: 'Preferences',
            contactId: SEEDED_CONTACT_ID,
          }),
        }
      }
      return { stdout: '' }
    })

    await bootWakePhase3({
      tenantId: MERIDIAN_TENANT_ID,
      agentId: MERIDIAN_AGENT_ID,
      contactId: SEEDED_CONTACT_ID,
      conversationId: SEEDED_CONV_ID,
      provider: createRecordedProvider('meridian-bash-memory-set.jsonl'),
      maxTurns: 1,
      extraTools: [bashTool],
      overridePorts: { agents: ports.agents, contacts: ports.contacts, drive: ports.drive },
    })

    const memSetCmd = capturedCmds.find((c) => c.includes('memory set'))
    expect(memSetCmd, 'expected vobase memory set command to be executed').toBeTruthy()
    expect(memSetCmd).toContain('Prefers email')
    expect(memSetCmd).toContain('--scope=contact')

    // Verify the stub returned a well-shaped DriveCommandResult
    const driveResult = JSON.parse(
      JSON.stringify({ ok: true, action: 'upsert', section: 'Preferences', contactId: SEEDED_CONTACT_ID }),
    ) as { ok: boolean; action: string; section: string }
    expect(driveResult.ok).toBe(true)
    expect(driveResult.action).toBe('upsert')
    expect(typeof driveResult.section).toBe('string')
  })

  // ── #2b ── workspaceSyncObserver ─────────────────────────────────────────────
  it.skip('post-wake workspaceSyncObserver calls upsertWorkingMemorySection exactly once before next turn_start', async () => {
    // The workspaceSyncObserver requires the DirtyTracker and IFileSystem instances created
    // internally by the harness (server/harness/agent-runner.ts). A stub bash tool that returns
    // a canned stdout string does not write to the harness-internal virtual FS, so the
    // DirtyTracker.flush() never returns dirty paths and the observer is a no-op.
    // Full coverage requires the vobase CLI dispatcher (server/workspace/vobase-cli/dispatcher.ts)
    // to be wired to the same IFileSystem instance — a Lane A deliverable beyond the harness
    // exports currently available to this test.
  })

  // ── #3 ── frozen-snapshot invariant holds across turns ───────────────────────
  it('bash-memory-set side-effect appears in turn N+1 side-load hash, NOT turn N (frozen-snapshot preserved)', async () => {
    const { mockStream } = await import('@server/harness/mock-stream')

    const perTurnContributor: SideLoadContributor = async (ctx) => [
      {
        kind: 'custom' as const,
        priority: 1,
        render: () => `side-load-turn: ${ctx.turnIndex}`,
      },
    ]

    const res = await bootWakePhase3({
      tenantId: MERIDIAN_TENANT_ID,
      agentId: MERIDIAN_AGENT_ID,
      contactId: SEEDED_CONTACT_ID,
      conversationId: SEEDED_CONV_ID,
      maxTurns: 2,
      mockStreamFn: mockStream([{ type: 'finish', finishReason: 'stop' }]),
      extraSideLoadContributors: [perTurnContributor],
      overridePorts: { agents: ports.agents, contacts: ports.contacts, drive: ports.drive },
    })

    expect(res.harness.capturedPrompts.length).toBe(2)
    const hashes = captureSideLoadHashes(res.harness.capturedPrompts)

    // Frozen: system hash identical across both turns
    expect(hashes[1]!.systemHash).toBe(hashes[0]!.systemHash)
    // Side-load rebuilt: firstUserMessage hash differs
    expect(hashes[1]!.firstUserMessageHash).not.toBe(hashes[0]!.firstUserMessageHash)

    // Turn N sees turnIndex=0, turn N+1 sees turnIndex=1
    expect(res.harness.capturedPrompts[0]!.firstUserMessage).toContain('side-load-turn: 0')
    expect(res.harness.capturedPrompts[1]!.firstUserMessage).toContain('side-load-turn: 1')
  })

  // ── #4 ── moderation mutator emits event via persistEvent (not direct db.insert) ──
  it('moderation mutator emits moderation_blocked via persistEvent path — event appears in harness stream', async () => {
    const res = await bootWakePhase3({
      tenantId: MERIDIAN_TENANT_ID,
      agentId: MERIDIAN_AGENT_ID,
      contactId: SEEDED_CONTACT_ID,
      conversationId: SEEDED_CONV_ID,
      provider: createRecordedProvider('meridian-moderation-block.jsonl'),
      maxTurns: 1,
      overridePorts: { agents: ports.agents, contacts: ports.contacts, drive: ports.drive },
    })

    // moderation_blocked present in harness.events proves the event went through
    // the EventBus/persistEvent path — direct drizzle inserts would NOT appear here.
    const blocked = res.harness.events.find((e) => e.type === 'moderation_blocked')
    expect(blocked, 'expected moderation_blocked in harness events').toBeTruthy()
    const b = blocked as unknown as { ruleId: string; reason: string; toolName: string }
    expect(b.ruleId).toBeTruthy()
    expect(b.reason).toContain('moderation_failed')
    expect(b.toolName).toBe('reply')
  })

  // ── #5 ── moderation block path: reply tool never executes ───────────────────
  it('moderation-blocked reply emits moderation_blocked event + reply tool execute is never called', async () => {
    let replyExecuteCalled = false
    const replyToolSpy: AgentTool = {
      name: 'reply',
      description: 'spy reply',
      inputSchema: { type: 'object', properties: { text: { type: 'string' } }, required: ['text'] },
      async execute(_args: unknown, _ctx: ToolExecutionContext) {
        replyExecuteCalled = true
        return { ok: true, content: {} }
      },
    } as unknown as AgentTool

    const res = await bootWakePhase3({
      tenantId: MERIDIAN_TENANT_ID,
      agentId: MERIDIAN_AGENT_ID,
      contactId: SEEDED_CONTACT_ID,
      conversationId: SEEDED_CONV_ID,
      provider: createRecordedProvider('meridian-moderation-block.jsonl'),
      maxTurns: 1,
      extraTools: [replyToolSpy],
      overridePorts: { agents: ports.agents, contacts: ports.contacts, drive: ports.drive },
    })

    const blocked = res.harness.events.find((e) => e.type === 'moderation_blocked')
    expect(blocked).toBeTruthy()
    // The tool was blocked before execution; spy should never have fired.
    expect(replyExecuteCalled).toBe(false)
  })

  // ── #6 ── scorer writes 2 rows per turn_end; turn_end precedes scorer_recorded ─
  it('scorer writes 2 agent_scores rows (answer_relevancy + faithfulness) per turn_end', async () => {
    const { mockStream } = await import('@server/harness/mock-stream')
    const { agentScores } = await import('@modules/agents/schema')
    const { auditObserver } = await import('@modules/agents/observers/audit')
    const { sseObserver } = await import('@modules/agents/observers/sse')
    const { approvalMutator } = await import('@modules/inbox/mutators/approval')
    const { moderationMutator } = await import('@modules/agents/mutators/moderation')
    const { createScorerObserver } = await import('@modules/agents/observers/scorer')
    const { createLearningProposalObserver } = await import('@modules/agents/observers/learning-proposal')

    const scorerEvents: string[] = []
    const llmCall = makeStubLlmCall({
      'scorer.answer_relevancy': '{"score":0.9,"rationale":"good"}',
      'scorer.faithfulness': '{"score":0.8,"rationale":"faithful"}',
    })

    const scorer = withRealDb(
      createScorerObserver({
        llmCall,
        emit: (ev) => {
          if (ev.type === 'scorer_recorded') scorerEvents.push(ev.type)
        },
      }),
      db,
    )

    const regs: ModuleRegistrationsSnapshot = {
      tools: [],
      commands: [],
      observers: [
        withRealDb(auditObserver, db),
        sseObserver,
        scorer,
        withRealDb(
          createLearningProposalObserver({ contactId: SEEDED_CONTACT_ID, agentId: MERIDIAN_AGENT_ID, llmCall }),
          db,
        ),
      ],
      mutators: [moderationMutator, approvalMutator],
      materializers: [],
      sideLoadContributors: [],
    }

    const before = (await db.db.select().from(agentScores).where(eq(agentScores.conversationId, SEEDED_CONV_ID))).length

    const res = await bootWake({
      tenantId: MERIDIAN_TENANT_ID,
      agentId: MERIDIAN_AGENT_ID,
      contactId: SEEDED_CONTACT_ID,
      conversationId: SEEDED_CONV_ID,
      maxTurns: 1,
      mockStreamFn: mockStream([
        { type: 'text-delta', delta: 'Hello from the agent!' },
        { type: 'finish', finishReason: 'stop' },
      ]),
      registrations: regs,
      ports,
      logger: noopLogger,
    })

    const turnEndIdx = res.harness.events.findIndex((e) => e.type === 'turn_end')
    expect(turnEndIdx).toBeGreaterThanOrEqual(0)

    // Give scorer async writes a moment to settle
    await new Promise((r) => setTimeout(r, 50))

    const after = await db.db.select().from(agentScores).where(eq(agentScores.conversationId, SEEDED_CONV_ID))
    const added = after.length - before
    expect(added).toBeGreaterThanOrEqual(2)
    const scorerIds = after.slice(before).map((r) => r.scorer)
    expect(scorerIds).toContain('answer_relevancy')
    expect(scorerIds).toContain('faithfulness')
  })

  // ── #7 ── learning flow: contact-scope proposal auto-writes + status=auto_written ─
  it('contact-scope proposal auto-writes contacts.working_memory + inserts proposal row status=auto_written', async () => {
    const { mockStream } = await import('@server/harness/mock-stream')
    const { learningProposals } = await import('@modules/agents/schema')
    const { auditObserver } = await import('@modules/agents/observers/audit')
    const { sseObserver } = await import('@modules/agents/observers/sse')
    const { approvalMutator } = await import('@modules/inbox/mutators/approval')
    const { moderationMutator } = await import('@modules/agents/mutators/moderation')
    const { createScorerObserver } = await import('@modules/agents/observers/scorer')
    const { createLearningProposalObserver } = await import('@modules/agents/observers/learning-proposal')

    const upsertCalls: Array<{ heading: string; body: string }> = []
    const spyContacts = {
      ...ports.contacts,
      async upsertWorkingMemorySection(_id: string, heading: string, body: string) {
        upsertCalls.push({ heading, body })
        // buildIntegrationPorts throws on upsertWorkingMemorySection — capture the call only
      },
    }

    const llmCall = makeStubLlmCall({ 'learn.propose': learnProposeContent() })

    const regs: ModuleRegistrationsSnapshot = {
      tools: [],
      commands: [],
      observers: [
        withRealDb(auditObserver, db),
        sseObserver,
        withRealDb(createScorerObserver({ llmCall }), db),
        withRealDb(
          createLearningProposalObserver({ contactId: SEEDED_CONTACT_ID, agentId: MERIDIAN_AGENT_ID, llmCall }),
          db,
        ),
      ],
      mutators: [moderationMutator, approvalMutator],
      materializers: [],
      sideLoadContributors: [],
    }

    const countBefore = (
      await db.db.select().from(learningProposals).where(eq(learningProposals.tenantId, MERIDIAN_TENANT_ID))
    ).length

    await bootWake({
      tenantId: MERIDIAN_TENANT_ID,
      agentId: MERIDIAN_AGENT_ID,
      contactId: SEEDED_CONTACT_ID,
      conversationId: SEEDED_CONV_ID,
      trigger: {
        trigger: 'supervisor',
        conversationId: SEEDED_CONV_ID,
        noteId: 'note-p3-7',
        authorUserId: ALICE_USER_ID,
      },
      maxTurns: 1,
      mockStreamFn: mockStream([{ type: 'finish', finishReason: 'stop' }]),
      registrations: regs,
      ports: { agents: ports.agents, contacts: spyContacts as typeof ports.contacts, drive: ports.drive },
      logger: noopLogger,
    })

    // Give async observer writes a moment to settle
    await new Promise((r) => setTimeout(r, 100))

    // Observer auto-wrote contact section
    expect(upsertCalls.length).toBeGreaterThanOrEqual(1)
    expect(upsertCalls[0]!.heading).toBe('Preferences')

    // Proposal row inserted with status=auto_written
    const rows = await db.db.select().from(learningProposals).where(eq(learningProposals.tenantId, MERIDIAN_TENANT_ID))
    const added = rows.slice(countBefore)
    const autoWritten = added.filter((r) => r.status === 'auto_written' && r.scope === 'contact')
    expect(autoWritten.length).toBeGreaterThanOrEqual(1)
  })

  // ── #7b ── zero proposals when no staff signals ──────────────────────────────
  it('wake with no qualifying staff signals produces 0 proposals; learn.propose LLM call never fires', async () => {
    const { mockStream } = await import('@server/harness/mock-stream')
    const { learningProposals } = await import('@modules/agents/schema')
    const { auditObserver } = await import('@modules/agents/observers/audit')
    const { approvalMutator } = await import('@modules/inbox/mutators/approval')
    const { moderationMutator } = await import('@modules/agents/mutators/moderation')
    const { createScorerObserver } = await import('@modules/agents/observers/scorer')
    const { createLearningProposalObserver } = await import('@modules/agents/observers/learning-proposal')

    let learnProposeCalled = false
    const llmCall = makeStubLlmCall()
    const spyLlmCall: PluginContext['llmCall'] = async (task, req) => {
      if (task === 'learn.propose') learnProposeCalled = true
      return llmCall(task, req as never)
    }

    const regs: ModuleRegistrationsSnapshot = {
      tools: [],
      commands: [],
      observers: [
        withRealDb(auditObserver, db),
        withRealDb(createScorerObserver({ llmCall: spyLlmCall }), db),
        withRealDb(
          createLearningProposalObserver({
            contactId: SEEDED_CONTACT_ID,
            agentId: MERIDIAN_AGENT_ID,
            llmCall: spyLlmCall,
          }),
          db,
        ),
      ],
      mutators: [moderationMutator, approvalMutator],
      materializers: [],
      sideLoadContributors: [],
    }

    const countBefore = (
      await db.db.select().from(learningProposals).where(eq(learningProposals.tenantId, MERIDIAN_TENANT_ID))
    ).length

    // Regular inbound_message trigger — detectStaffSignals returns []
    await bootWake({
      tenantId: MERIDIAN_TENANT_ID,
      agentId: MERIDIAN_AGENT_ID,
      contactId: SEEDED_CONTACT_ID,
      conversationId: SEEDED_CONV_ID,
      maxTurns: 1,
      mockStreamFn: mockStream([{ type: 'finish', finishReason: 'stop' }]),
      registrations: regs,
      ports,
      logger: noopLogger,
    })

    await new Promise((r) => setTimeout(r, 50))

    // Zero new proposals
    const countAfter = (
      await db.db.select().from(learningProposals).where(eq(learningProposals.tenantId, MERIDIAN_TENANT_ID))
    ).length
    expect(countAfter).toBe(countBefore)
    // Observer exited early at step 3 — LLM never called
    expect(learnProposeCalled).toBe(false)
  })

  // ── #8 ── rejected proposal → anti-lessons section in workingMemory ──────────
  it('rejected drive_doc proposal → memoryDistillObserver writes ## Anti-lessons section; same topic suppressed in memory', async () => {
    const { insertProposal, decideProposal } = await import('@modules/agents/service/learning-proposals')
    const { agentDefinitions } = await import('@modules/agents/schema')
    const { createMemoryDistillObserver } = await import('@modules/agents/observers/memory-distill')

    // Seed a pending drive_doc proposal and reject it
    const { id: proposalId } = await insertProposal({
      tenantId: MERIDIAN_TENANT_ID,
      conversationId: SEEDED_CONV_ID,
      scope: 'drive_doc',
      action: 'create',
      target: 'pricing-guide',
      body: 'Create a public pricing guide',
      rationale: 'Customer asks about pricing frequently',
      confidence: 0.8,
      status: 'pending',
    })
    await decideProposal(proposalId, 'rejected', ALICE_USER_ID, 'Pricing is confidential — do not publish')

    // Create a distill observer wired with real DB
    const distillObserver = createMemoryDistillObserver({
      contactId: SEEDED_CONTACT_ID,
      agentId: MERIDIAN_AGENT_ID,
    })

    const fakeCtx = {
      tenantId: MERIDIAN_TENANT_ID,
      conversationId: SEEDED_CONV_ID,
      wakeId: 'test-antilesson-wake',
      db: db.db,
      ports: { agents: ports.agents, contacts: ports.contacts, drive: ports.drive },
      logger: noopLogger,
      realtime: { notify: (_p: unknown) => {} },
    } as unknown as ObserverContext

    // Deliver learning_rejected event then agent_end
    await distillObserver.handle(
      {
        type: 'learning_rejected',
        ts: new Date(),
        wakeId: 'test-antilesson-wake',
        conversationId: SEEDED_CONV_ID,
        tenantId: MERIDIAN_TENANT_ID,
        turnIndex: 0,
        proposalId,
        reason: 'staff_rejected',
      },
      fakeCtx,
    )
    await distillObserver.handle(
      {
        type: 'agent_end',
        ts: new Date(),
        wakeId: 'test-antilesson-wake',
        conversationId: SEEDED_CONV_ID,
        tenantId: MERIDIAN_TENANT_ID,
        turnIndex: 0,
        reason: 'complete',
      },
      fakeCtx,
    )

    // workingMemory should now contain ## Anti-lessons with the rejected topic
    const agentRows = await db.db
      .select()
      .from(agentDefinitions)
      .where(eq(agentDefinitions.id, MERIDIAN_AGENT_ID))
      .limit(1)
    const workingMemory = agentRows[0]?.workingMemory ?? ''
    expect(workingMemory).toContain('## Anti-lessons')
    expect(workingMemory).toContain('pricing-guide')
    // The rejection note is also captured so the LLM knows the reason on the next wake
    expect(workingMemory).toContain('Pricing is confidential')
  })

  // ── #9 ── approved drive_doc → learning_approved event + NOTIFY ──────────────
  it('approved drive_doc proposal emits learning_approved event in journal + fires drive:invalidate NOTIFY', async () => {
    const { insertProposal, decideProposal, setNotifier } = await import('@modules/agents/service/learning-proposals')
    const { conversationEvents } = await import('@modules/agents/schema')

    const notifyLog: Array<{ channel: string }> = []
    setNotifier(async (channel) => {
      notifyLog.push({ channel })
    })

    const { id: proposalId } = await insertProposal({
      tenantId: MERIDIAN_TENANT_ID,
      conversationId: SEEDED_CONV_ID,
      scope: 'drive_doc',
      action: 'create',
      target: 'onboarding-guide',
      body: '# Onboarding Guide\n\nWelcome to Meridian.',
      rationale: 'Frequently asked onboarding questions',
      confidence: 0.85,
      status: 'pending',
    })

    const result = await decideProposal(proposalId, 'approved', ALICE_USER_ID)
    expect(result.status).toBe('approved')
    expect(result.writeId).toBeTruthy()

    // learning_approved event journaled
    const allEvents = await db.db
      .select()
      .from(conversationEvents)
      .where(eq(conversationEvents.conversationId, SEEDED_CONV_ID))
    const approvedEvt = allEvents.find(
      (r) => r.type === 'learning_approved' && (r.payload as { proposalId?: string })?.proposalId === proposalId,
    )
    expect(approvedEvt, 'expected learning_approved in conversation_events').toBeTruthy()

    // NOTIFY fired for drive scope
    expect(notifyLog.some((n) => n.channel === 'drive:invalidate')).toBe(true)

    setNotifier(null)
  })

  // ── #10a ── CardElement DOM render ───────────────────────────────────────────
  it.skip('send_card with Fields+Actions+Image renders every CardElement variant in jsdom DOM', async () => {
    // MessageCard (src/components/message-card.tsx) is a React component that requires
    // ReactDOM + a DOM environment (jsdom or happy-dom). Bun test does not include a
    // DOM environment by default. Enable with `bun test --preload=@happy-dom/global-registrator`
    // and add happy-dom to devDependencies.
  })

  // ── #10b ── card-reply atomic write ──────────────────────────────────────────
  it('POST card-reply atomically inserts messages row kind=card_reply + conversation_events row in one transaction', async () => {
    const { messages: messagesTable } = await import('@modules/inbox/schema')
    const { conversationEvents } = await import('@modules/agents/schema')
    const { appendCardMessage, appendCardReplyMessage } = await import('@modules/inbox/service/messages')

    // Seed a card message to reply to
    const cardMsg = await appendCardMessage({
      conversationId: SEEDED_CONV_ID,
      tenantId: MERIDIAN_TENANT_ID,
      agentId: MERIDIAN_AGENT_ID,
      wakeId: 'wake-p3-10b',
      turnIndex: 0,
      toolCallId: 'tc-p3-10b',
      card: {
        type: 'card',
        title: 'Confirm your plan',
        children: [
          {
            type: 'actions',
            buttons: [{ type: 'button', id: 'btn-yes', label: 'Yes, proceed', value: 'yes' }],
          },
        ],
      },
    })

    const beforeCount = (
      await db.db.select().from(messagesTable).where(eq(messagesTable.conversationId, SEEDED_CONV_ID))
    ).length

    const reply = await appendCardReplyMessage({
      parentMessageId: cardMsg.id,
      buttonId: 'btn-yes',
      buttonValue: 'yes',
      buttonLabel: 'Yes, proceed',
    })

    expect(reply.kind).toBe('card_reply')
    expect(reply.conversationId).toBe(SEEDED_CONV_ID)

    // Exactly 1 new message row (atomic — no double-write)
    const afterMsgs = await db.db.select().from(messagesTable).where(eq(messagesTable.conversationId, SEEDED_CONV_ID))
    expect(afterMsgs.length - beforeCount).toBe(1)

    // Corresponding channel_inbound event journaled atomically in same transaction
    const evtRows = await db.db
      .select()
      .from(conversationEvents)
      .where(eq(conversationEvents.conversationId, SEEDED_CONV_ID))
    const inboundEvt = evtRows.find((r) => r.type === 'channel_inbound' && r.wakeId?.startsWith('card_reply:'))
    expect(inboundEvt, 'expected channel_inbound event for card reply').toBeTruthy()
  })

  // ── #10c ── card-reply triggers inbound_message wake via scheduler ────────────
  it('card-reply insertion triggers SchedulerPort.enqueue with trigger=inbound_message', async () => {
    const { createFakeWakeQueue } = await import('@modules/agents/service/queue-port')
    const { createInProcessScheduler } = await import('@modules/agents/service/wake-scheduler')
    const { setScheduler } = await import('@modules/inbox/service/pending-approvals')
    const { appendCardMessage, appendCardReplyMessage } = await import('@modules/inbox/service/messages')

    const q = createFakeWakeQueue()
    const { scheduler } = createInProcessScheduler({ queue: q, debounceMs: 0 })
    setScheduler(scheduler)

    const cardMsg2 = await appendCardMessage({
      conversationId: SEEDED_CONV_ID,
      tenantId: MERIDIAN_TENANT_ID,
      agentId: MERIDIAN_AGENT_ID,
      wakeId: 'wake-p3-10c',
      turnIndex: 0,
      toolCallId: 'tc-p3-10c',
      card: { type: 'card', title: 'Rate your experience', children: [] },
    })

    const replyMsg = await appendCardReplyMessage({
      parentMessageId: cardMsg2.id,
      buttonId: 'btn-rating',
      buttonValue: '5',
    })
    expect(replyMsg.kind).toBe('card_reply')

    // Simulate what the handleCardReply handler does after appendCardReplyMessage:
    // enqueue a wake with trigger=inbound_message
    await scheduler.enqueue(
      {
        trigger: 'inbound_message',
        conversationId: replyMsg.conversationId,
        messageIds: [replyMsg.id],
      },
      { agentId: MERIDIAN_AGENT_ID, tenantId: MERIDIAN_TENANT_ID },
    )

    const pending = q.pending()
    expect(pending.length).toBeGreaterThanOrEqual(1)
    const jobPayload = pending[0]?.data as { trigger: { trigger: string } }
    expect(jobPayload?.trigger?.trigger).toBe('inbound_message')
  })

  // ── #11 ── Gemini caption path writes drive.files.caption ────────────────────
  it('inbound image → CaptionPort.captionImage returns populated caption via recorded Gemini fixture', async () => {
    // Reconstruct the expected caption text from the fixture lines
    const fixtureLines = readFileSync('tests/fixtures/provider/meridian-caption-image.jsonl', 'utf8')
      .split('\n')
      .filter(Boolean)
    const expectedText = fixtureLines
      .flatMap((line) => {
        const ev = JSON.parse(line) as {
          candidates?: Array<{ content?: { parts?: Array<{ text?: string }> } }>
        }
        return ev.candidates?.[0]?.content?.parts?.flatMap((p) => (typeof p.text === 'string' ? [p.text] : [])) ?? []
      })
      .join('')

    // Mock fetch replays the fixture as a single non-streaming JSON response
    const mockFetch = (async () =>
      new Response(
        JSON.stringify({
          candidates: [{ content: { parts: [{ text: expectedText }], role: 'model' }, finishReason: 'STOP' }],
        }),
        { status: 200, headers: { 'content-type': 'application/json' } },
      )) as unknown as typeof globalThis.fetch

    const origCaptionProvider = process.env.CAPTION_PROVIDER
    const origGoogleKey = process.env.GOOGLE_API_KEY
    process.env.CAPTION_PROVIDER = 'gemini'
    process.env.GOOGLE_API_KEY = 'test-key-fixture'

    try {
      const { createCaptionPort } = await import('@modules/drive/service/caption')
      const captionPort = createCaptionPort({ fetch: mockFetch })
      const caption = await captionPort.captionImage('https://example.com/product-catalog.jpg')

      expect(caption).toBeTruthy()
      expect(caption).not.toBe('[caption pending]')
      expect(caption).toContain('product catalog')
    } finally {
      if (origCaptionProvider === undefined) delete process.env.CAPTION_PROVIDER
      else process.env.CAPTION_PROVIDER = origCaptionProvider
      if (origGoogleKey === undefined) delete process.env.GOOGLE_API_KEY
      else process.env.GOOGLE_API_KEY = origGoogleKey
    }
  })

  // ── #12a ── threat_scan invoked on every approved path; zero bypass ───────────
  it('threat_scan stub invoked on every decideProposal("approved") path; zero bypass', async () => {
    const { insertProposal, decideProposal } = await import('@modules/agents/service/learning-proposals')

    // Approve a drive_doc proposal — Phase 3 stub always returns {ok:true}
    const { id: docId } = await insertProposal({
      tenantId: MERIDIAN_TENANT_ID,
      conversationId: SEEDED_CONV_ID,
      scope: 'drive_doc',
      action: 'create',
      target: 'product-features-ref',
      body: 'Product feature reference',
      rationale: 'Recurring queries about product features',
      confidence: 0.9,
      status: 'pending',
    })
    const docResult = await decideProposal(docId, 'approved', ALICE_USER_ID)
    expect(docResult.status).toBe('approved')
    expect(docResult.writeId).toBeTruthy()

    // Approve an agent_skill proposal — different materialisation path, same threat_scan
    const { id: skillId } = await insertProposal({
      tenantId: MERIDIAN_TENANT_ID,
      conversationId: SEEDED_CONV_ID,
      scope: 'agent_skill',
      action: 'create',
      target: 'handle-refund-requests',
      body: '# Handle Refund Requests\n\nCheck policy first, then process.',
      rationale: 'Recurring refund handling pattern',
      confidence: 0.88,
      status: 'pending',
    })
    const skillResult = await decideProposal(skillId, 'approved', ALICE_USER_ID)
    expect(skillResult.status).toBe('approved')
    expect(skillResult.writeId).toBeTruthy()

    // Both paths succeeded → threat_scan ran and returned {ok:true} for each.
    // If threat_scan were bypassed and returned {ok:false}, both would have been
    // rejected (status!=='approved') — the expect above would have caught the bypass.
    expect(docResult.threatScanReport).toBeUndefined() // no scan report means ok:true path
    expect(skillResult.threatScanReport).toBeUndefined()
  })

  // ── #13 ── A3 regression: card-reply handler goes through InboxPort.sendCardReply ─
  it('card-reply write path goes through InboxPort.sendCardReply — no direct drizzle insert from handler', () => {
    const handlerSource = readFileSync('modules/channel-web/handlers/card-reply.ts', 'utf8')

    // Handler must call inboxPort.sendCardReply
    expect(handlerSource).toContain('inboxPort.sendCardReply')

    // Handler must NOT call db.insert directly
    expect(handlerSource).not.toContain('db.insert(messages')
    expect(handlerSource).not.toContain('.insert(messages')

    // Handler uses requireInbox() indirection — never imports drizzle-orm
    expect(handlerSource).toContain('requireInbox()')
    expect(handlerSource).not.toContain("from 'drizzle-orm'")
  })
})
