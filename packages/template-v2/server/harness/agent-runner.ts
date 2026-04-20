/**
 * Wake harness — the core `bootWake()` entry point.
 *
 * Drives the full event lifecycle:
 *   `agent_start` → `turn_start` → `llm_call` → `message_start` →
 *   `message_update*` (≥1) → `message_end` → `turn_end` → `agent_end`
 *
 * Every event fans out through `ctx.events.publish(event)` so `ObserverBus`
 * observers AND the journal (`agents.service.journal.append`) receive them.
 * Tool calls run through the mutator chain (approvalMutator etc.).
 */

import { createLearningProposalObserver } from '@modules/agents/observers/learning-proposal'
import { createMemoryDistillObserver } from '@modules/agents/observers/memory-distill'
import { createWorkspaceSyncObserver } from '@modules/agents/observers/workspace-sync'
import { getLastWakeTail } from '@modules/agents/service/journal'
import type { AbortContext } from '@server/contracts/abort-context'
import type { AgentsPort } from '@server/contracts/agents-port'
import type { ContactsPort } from '@server/contracts/contacts-port'
import type { AgentDefinition } from '@server/contracts/domain-types'
import type { DrivePort } from '@server/contracts/drive-port'
import type {
  AgentAbortedEvent,
  AgentEndEvent,
  AgentEvent,
  AgentStartEvent,
  BudgetWarningEvent,
  LlmCallEvent,
  MessageEndEvent,
  MessageStartEvent,
  MessageUpdateEvent,
  PreCompactionEvent,
  SteerInjectedEvent,
  ToolExecutionEndEvent,
  ToolExecutionStartEvent,
  TurnEndEvent,
  TurnStartEvent,
  WakeTrigger,
} from '@server/contracts/event'
import type { BudgetState, IterationBudget } from '@server/contracts/iteration-budget'
import type { AgentMutator, AgentStep, MutatorContext } from '@server/contracts/mutator'
import type { AgentObserver, Logger, ObserverContext } from '@server/contracts/observer'
import type {
  AgentTool,
  CommandDef,
  EventBus,
  LlmRequest,
  ObserverFactory,
  PluginContext,
} from '@server/contracts/plugin-context'
import type { LlmFinish, LlmProvider } from '@server/contracts/provider-port'
import type { SideLoadContributor, WorkspaceMaterializer } from '@server/contracts/side-load'
import type { WakeContext } from '@server/contracts/wake-context'
import { EventBus as DefaultEventBus } from '@server/runtime/event-bus'
import { assessBudget, worstCaseDeltaExceeds } from '@server/runtime/iteration-budget-runtime'
import { newWakeId } from '@server/runtime/llm-call'
import { MutatorChain } from '@server/runtime/mutator-chain'
import { ObserverBus } from '@server/runtime/observer-bus'
import { makeResilientProvider } from '@server/runtime/resilient-provider'
import type { SteerQueueHandle } from '@server/runtime/steer-queue'
import { createWorkspace, type WorkspaceHandle } from '@server/workspace/create-workspace'
import { DirtyTracker } from '@server/workspace/dirty-tracker'
import { nanoid } from 'nanoid'
import { drainProviderTurn } from './agent-adapter'
import { type BashToolArgs, makeBashTool } from './bash-tool'
import { buildFrozenPrompt } from './frozen-prompt-builder'
import { type MockStreamEvent, mockStream, type StreamFn } from './mock-stream'
import { createRestartRecoveryContributor } from './restart-recovery'
import { type CustomSideLoadMaterializer, collectSideLoad, createBashHistoryMaterializer } from './side-load-collector'
import { TurnBudget } from './turn-budget'

// ----- types ---------------------------------------------------------------

export interface ModuleRegistrationsSnapshot {
  tools: readonly AgentTool[]
  commands: readonly CommandDef[]
  observers: readonly AgentObserver[]
  observerFactories?: readonly ObserverFactory[]
  mutators: readonly AgentMutator[]
  materializers: readonly WorkspaceMaterializer[]
  sideLoadContributors: readonly SideLoadContributor[]
}

export interface BootWakeOpts {
  organizationId: string
  agentId: string
  contactId: string
  trigger?: WakeTrigger
  /**
   * Mock stream. Required unless `provider` is set. When both are present,
   * `provider` wins for the turn stream and `mockStreamFn` is ignored.
   */
  mockStreamFn?: StreamFn
  /**
   * Real LLM provider. When set, each turn's stream is sourced from
   * `provider.stream(request)` — the harness drains chunks into the existing
   * `MockStreamEvent` state machine, preserving event ordering. The terminal
   * `LlmFinish` patches the `llm_call` event with real tokens/cost/latency/cacheHit.
   */
  provider?: LlmProvider
  /**
   * Model id passed to the provider (defaults to 'mock-llm' for the mock path
   * and to `agentDefinition.model` when a provider is supplied).
   */
  model?: string
  /** Per-wake registrations (aggregated by the caller). */
  registrations: ModuleRegistrationsSnapshot
  /** Supplies the agent definition + journal append + contact lookups. */
  ports: {
    agents: AgentsPort
    drive: DrivePort
    contacts: ContactsPort
  }
  /** When omitted, the runner creates a private `EventBus`. */
  events?: EventBus
  /** When omitted, a noop logger is used. */
  logger?: Logger
  /** Max turns to run (default 1). */
  maxTurns?: number
  /** Minted automatically when omitted. */
  conversationId?: string
  /** For the assertion-12 round-trip — runner writes these during a turn. */
  preWakeWrites?: ReadonlyArray<{ path: string; content: string }>
  /**
   * Per-wake LLM chokepoint threaded to reflection observers (memory-distill,
   * learning-proposal). When omitted, memory-distill falls back to its
   * deterministic stub and learning-proposal is not registered.
   */
  observerLlmCall?: PluginContext['llmCall']
  /** Per-wake iteration and cost budget. */
  iterationBudget?: IterationBudget
  /** Abort coordination carrier — defaults to a fresh AbortController. */
  abortCtx?: AbortContext
  /** Inbound steer messages drained between turns. */
  steerQueue?: SteerQueueHandle
}

export interface CapturedPrompt {
  system: string
  systemHash: string
  firstUserMessage: string
}

export interface HarnessHandle {
  capturedPrompts: CapturedPrompt[]
  events: readonly AgentEvent[]
  workspace: WorkspaceHandle
  dirtyTracker: DirtyTracker
  simulateToolCall: (name: string, args: unknown) => Promise<void>
  registerSideLoadMaterializer: (m: CustomSideLoadMaterializer) => void
  preWakeWrite: (path: string, content: string) => Promise<void>
}

export interface BootWakeResult {
  harness: HarnessHandle
  conversationId: string
  wakeId: string
}

// ----- default/no-op deps --------------------------------------------------

const noopLogger: Logger = {
  debug: () => undefined,
  info: () => undefined,
  warn: () => undefined,
  error: () => undefined,
}

// ----- event helpers -------------------------------------------------------

interface WakeScope {
  organizationId: string
  conversationId: string
  wakeId: string
  turnIndex: number
}

function baseEventFields(scope: WakeScope) {
  return {
    ts: new Date(),
    wakeId: scope.wakeId,
    conversationId: scope.conversationId,
    organizationId: scope.organizationId,
    turnIndex: scope.turnIndex,
  }
}

// ----- main entry ----------------------------------------------------------

export async function bootWake(opts: BootWakeOpts): Promise<BootWakeResult> {
  const wakeId = newWakeId()
  const conversationId = opts.conversationId ?? nanoid(10)
  const logger = opts.logger ?? noopLogger
  const events = opts.events ?? new DefaultEventBus()

  // Resolve agent definition (frozen for the wake).
  const agentDefinition: AgentDefinition = await opts.ports.agents.getAgentDefinition(opts.agentId)

  // ---- Observer bus ------------------------------------------------------
  // The harness path doesn't wire `inbox`, `caption`, or a raw `db` handle into
  // observers (those are unit-test seams). Throw-on-access guards turn an
  // accidental future use into an obvious crash instead of a confusing TypeError.
  const unwiredPort = (name: string) =>
    new Proxy(
      {},
      {
        get(_t, prop) {
          throw new Error(`harness observer ctx: ${name}.${String(prop)} accessed but not wired`)
        },
      },
    ) as never
  const observerCtx: ObserverContext = {
    organizationId: opts.organizationId,
    conversationId,
    wakeId,
    ports: {
      inbox: unwiredPort('ports.inbox'),
      contacts: opts.ports.contacts,
      drive: opts.ports.drive,
      agents: opts.ports.agents,
      caption: unwiredPort('ports.caption'),
    },
    db: unwiredPort('db'),
    logger,
    realtime: { notify: () => undefined },
  }
  const observers = new ObserverBus({ logger, observerCtx })
  for (const obs of opts.registrations.observers) observers.register(obs)

  // Observer factories receive a live WakeContext so they can capture per-wake
  // bindings (e.g. `llmCall`) that are boot-time throw-proxies.
  if (opts.registrations.observerFactories && opts.registrations.observerFactories.length > 0) {
    const llmCallForWake =
      opts.observerLlmCall ??
      (async () => {
        throw new Error('observer factory invoked llmCall but bootWake was not supplied with `observerLlmCall`')
      })
    const wakeCtx: WakeContext = {
      organizationId: opts.organizationId,
      wakeId,
      conversationId,
      agentId: opts.agentId,
      logger,
      llmCall: llmCallForWake as PluginContext['llmCall'],
    }
    for (const factory of opts.registrations.observerFactories) {
      observers.register(factory(wakeCtx))
    }
  }

  // Bridge EventBus → ObserverBus + journal (serialized to preserve DB PK order).
  const eventLog: AgentEvent[] = []
  let journalChain: Promise<void> = Promise.resolve()
  const unsub = events.subscribe((ev) => {
    eventLog.push(ev)
    observers.publish(ev)
    journalChain = journalChain
      .then(() => opts.ports.agents.appendEvent(ev))
      .catch((err) => {
        logger.error({ err, eventType: ev.type, wakeId, conversationId }, 'journal append failed')
      })
  })

  // ---- Build workspace ---------------------------------------------------
  const workspace = await createWorkspace({
    organizationId: opts.organizationId,
    agentId: opts.agentId,
    contactId: opts.contactId,
    conversationId,
    wakeId,
    agentDefinition,
    commands: opts.registrations.commands,
    materializers: opts.registrations.materializers,
    drivePort: opts.ports.drive,
    contactsPort: opts.ports.contacts,
    agentsPort: opts.ports.agents,
  })

  const dirtyTracker = new DirtyTracker(workspace.initialSnapshot)
  observers.register(
    createWorkspaceSyncObserver({ fs: workspace.innerFs, tracker: dirtyTracker, contactId: opts.contactId }),
  )
  observers.register(
    createMemoryDistillObserver({
      contactId: opts.contactId,
      agentId: opts.agentId,
      llmCall: opts.observerLlmCall,
    }),
  )
  if (opts.observerLlmCall) {
    observers.register(
      createLearningProposalObserver({
        contactId: opts.contactId,
        agentId: opts.agentId,
        llmCall: opts.observerLlmCall,
      }),
    )
  }

  // Apply any pre-wake writes the caller staged (test harness).
  for (const w of opts.preWakeWrites ?? []) {
    await workspace.innerFs.writeFile(w.path, w.content)
  }

  const turnBudget = new TurnBudget()

  // Build the single bash tool (and allow mutator/tool-result hydration later).
  const bashTool = makeBashTool({
    bash: workspace.bash,
    innerWrite: async (path, content) => {
      await workspace.innerFs.writeFile(path, content)
    },
    turnBudget,
    onSpill: (ev) => events.publish(ev),
  })
  const toolIndex = new Map<string, AgentTool>()
  toolIndex.set('bash', bashTool as unknown as AgentTool)
  for (const t of opts.registrations.tools) toolIndex.set(t.name, t)

  // ---- Mutator chain -----------------------------------------------------
  const mutators = new MutatorChain(opts.registrations.mutators)
  const capturedPrompts: CapturedPrompt[] = []
  const customSideLoad: CustomSideLoadMaterializer[] = []

  // Bash commands run in turn N appear in turn N+1's side-load (frozen-snapshot
  // invariant — mid-wake writes never affect the turn that produced them).
  let lastTurnBashCmds: string[] = []
  let currentTurnBashCmds: string[] = []
  customSideLoad.push(createBashHistoryMaterializer(() => lastTurnBashCmds))
  customSideLoad.push(createRestartRecoveryContributor(conversationId, getLastWakeTail))

  // ---- Emit agent_start --------------------------------------------------
  const frozen0 = await buildFrozenPrompt({
    bash: workspace.bash,
    agentDefinition,
    organizationId: opts.organizationId,
    contactId: opts.contactId,
    conversationId,
  })
  const trigger: WakeTrigger = opts.trigger ?? {
    trigger: 'manual',
    conversationId,
    reason: 'bootWake-default',
    actorUserId: opts.agentId,
  }
  const startEvt: AgentStartEvent = {
    ...baseEventFields({ organizationId: opts.organizationId, conversationId, wakeId, turnIndex: 0 }),
    type: 'agent_start',
    agentId: opts.agentId,
    trigger: trigger.trigger,
    triggerPayload: trigger,
    systemHash: frozen0.systemHash,
  }
  events.publish(startEvt)

  // ---- Turn loop ---------------------------------------------------------
  const maxTurns = opts.iterationBudget?.maxTurnsPerWake ?? opts.maxTurns ?? 1
  let endReason: AgentEndEvent['reason'] = 'complete'
  const abortSignal = opts.abortCtx?.wakeAbort.signal
  let pendingSteerText: string | null = null

  let resilientTurnIndex = 0
  const activeProvider = opts.provider
    ? makeResilientProvider(opts.provider, {
        events,
        logger,
        getScope: () => ({
          organizationId: opts.organizationId,
          conversationId,
          wakeId,
          turnIndex: resilientTurnIndex,
        }),
      })
    : undefined

  let preCompactionEmitted = false

  const budgetState: BudgetState = { turnsConsumed: 0, spentUsd: 0 }
  // Per-input vs per-output token rates are tracked separately so the
  // worst-case-delta check stays accurate when the model's output price diverges
  // from input price (typical 4× spread for Anthropic). Providers that don't
  // split cost fall back to a 50/50 split of `costUsd`.
  let lastCostPerInputToken = 0
  let lastCostPerOutputToken = 0
  let budgetWarningSideLoad: string | null = null
  if (opts.iterationBudget) {
    customSideLoad.push({
      kind: 'custom',
      priority: 90,
      contribute: () => budgetWarningSideLoad ?? '',
    })
  }

  for (let turnIndex = 0; turnIndex < maxTurns; turnIndex += 1) {
    const scope: WakeScope = { organizationId: opts.organizationId, conversationId, wakeId, turnIndex }

    // Pre-turn worst-case delta: refuse if projected next-turn spend exceeds hard ceiling.
    if (opts.iterationBudget && (lastCostPerInputToken > 0 || lastCostPerOutputToken > 0)) {
      if (
        worstCaseDeltaExceeds(opts.iterationBudget, budgetState.spentUsd, lastCostPerInputToken, lastCostPerOutputToken)
      ) {
        const worstCaseEvt: BudgetWarningEvent = {
          ...baseEventFields(scope),
          type: 'budget_warning',
          phase: 'hard',
          turnsConsumed: budgetState.turnsConsumed,
          spentUsd: budgetState.spentUsd,
        }
        events.publish(worstCaseEvt)
        endReason = 'blocked'
        break
      }
    }

    // turn_start
    const turnStart: TurnStartEvent = { ...baseEventFields(scope), type: 'turn_start' }
    events.publish(turnStart)
    turnBudget.reset()

    if (turnIndex > 0 && !preCompactionEmitted) {
      preCompactionEmitted = true
      const preCompEvt: PreCompactionEvent = { ...baseEventFields(scope), type: 'pre_compaction' }
      events.publish(preCompEvt)
    }

    // Rebuild side-load FRESH each turn so mid-wake writes propagate (frozen-snapshot invariant).
    const sideLoadBody = await collectSideLoad({
      ctx: {
        organizationId: opts.organizationId,
        conversationId,
        agentId: opts.agentId,
        contactId: opts.contactId,
        turnIndex,
      },
      contributors: opts.registrations.sideLoadContributors,
      customMaterializers: customSideLoad,
      bash: workspace.bash,
    })
    let firstUserMessage = sideLoadBody
      ? `${sideLoadBody}\n\n${renderTriggerMessage(trigger)}`
      : renderTriggerMessage(trigger)

    // Inject steer text accumulated from the previous turn (before capturedPrompts snapshot).
    if (pendingSteerText !== null) {
      const steerEvt: SteerInjectedEvent = {
        ...baseEventFields(scope),
        type: 'steer_injected',
        text: pendingSteerText,
      }
      events.publish(steerEvt)
      firstUserMessage = `${pendingSteerText}\n\n${firstUserMessage}`
      pendingSteerText = null
    }

    // Frozen prompt is computed ONCE — reuse the turn-0 snapshot for subsequent turns.
    capturedPrompts.push({
      system: frozen0.system,
      systemHash: frozen0.systemHash,
      firstUserMessage,
    })

    resilientTurnIndex = turnIndex
    const pending: MockStreamEvent[] = []
    let providerFinish: LlmFinish | undefined
    let providerStreamAborted = false

    if (activeProvider) {
      const req: LlmRequest = {
        model: opts.model ?? agentDefinition.model,
        system: frozen0.system,
        messages: [{ role: 'user', content: firstUserMessage }],
        tools: Array.from(toolIndex.values()),
        stream: true,
        signal: abortSignal,
      }
      try {
        const drained = await drainProviderTurn(activeProvider, req)
        providerFinish = drained.finish
        for (const ev of drained.events) pending.push(ev)
      } catch (err) {
        if (abortSignal?.aborted) {
          providerStreamAborted = true
        } else {
          throw err
        }
      }
    } else if (opts.mockStreamFn) {
      const streamGen = opts.mockStreamFn()
      for await (const ev of streamGen) pending.push(ev)
    } else {
      throw new Error('bootWake: either `provider` or `mockStreamFn` must be supplied')
    }

    const providerName = activeProvider?.name ?? 'mock'
    const modelId = opts.model ?? (activeProvider ? agentDefinition.model : 'mock-llm')

    // llm_call — mock path uses stable placeholders; provider path carries the
    // terminal `finish` chunk metadata (real tokens/cost/latency/cacheHit).
    const llmEvt: LlmCallEvent = {
      ...baseEventFields(scope),
      type: 'llm_call',
      task: 'agent.turn',
      model: modelId,
      provider: providerName,
      tokensIn: providerFinish?.tokensIn ?? firstUserMessage.length,
      tokensOut: providerFinish?.tokensOut ?? 0,
      cacheReadTokens: providerFinish?.cacheReadTokens ?? 0,
      costUsd: providerFinish?.costUsd ?? 0,
      latencyMs: providerFinish?.latencyMs ?? 0,
      cacheHit: providerFinish?.cacheHit ?? false,
    }
    events.publish(llmEvt)

    // message_start
    const messageId = nanoid(10)
    const msgStart: MessageStartEvent = {
      ...baseEventFields(scope),
      type: 'message_start',
      messageId,
      role: 'assistant',
    }
    events.publish(msgStart)

    // Emit at least one message_update (B4 invariant).
    let sawUpdate = false
    let assembledContent = ''
    for (const ev of pending) {
      if (ev.type === 'text-delta') {
        sawUpdate = true
        const update: MessageUpdateEvent = {
          ...baseEventFields(scope),
          type: 'message_update',
          messageId,
          delta: ev.delta,
        }
        assembledContent += ev.delta
        events.publish(update)
      }
    }
    if (!sawUpdate) {
      const update: MessageUpdateEvent = {
        ...baseEventFields(scope),
        type: 'message_update',
        messageId,
        delta: '',
      }
      events.publish(update)
    }

    // Find the finish event (one of them should exist; mock-stream guarantees it).
    const finish = pending.find((e) => e.type === 'finish')
    const finishReason = finish ? (finish as { finishReason: string }).finishReason : 'stop'

    // Tool calls: run through mutator chain.
    const toolCalls = pending.filter((e) => e.type === 'tool-call') as Array<
      Extract<MockStreamEvent, { type: 'tool-call' }>
    >
    let blocked: { reason: string } | null = null
    let abortedAt: 'pre_tool' | 'in_tool' | 'post_tool' | null = null
    if (providerStreamAborted || abortSignal?.aborted) {
      abortedAt = 'pre_tool'
    }
    for (const call of toolCalls) {
      if (abortedAt !== null) break
      if (abortSignal?.aborted) {
        abortedAt = 'post_tool'
        break
      }
      const toolCallId = call.toolCallId ?? nanoid(10)
      const step: AgentStep = { toolCallId, toolName: call.toolName, args: call.args }
      const mutatorCtx: MutatorContext = {
        ...observerCtx,
        llmCall: async () => {
          throw new Error('mutators must not llmCall in Phase 1')
        },
        persistEvent: async (ev) => {
          events.publish(ev)
        },
      }
      const decision = await mutators.runBefore(step, mutatorCtx)
      if (decision?.action === 'block') {
        blocked = { reason: decision.reason }
        break
      }
      const effectiveArgs = decision?.action === 'transform' ? decision.args : call.args

      if (call.toolName === 'bash') {
        const cmd = (effectiveArgs as Partial<BashToolArgs>)?.command
        if (typeof cmd === 'string' && cmd.length > 0) currentTurnBashCmds.push(cmd)
      }

      const toolStart: ToolExecutionStartEvent = {
        ...baseEventFields(scope),
        type: 'tool_execution_start',
        toolCallId,
        toolName: call.toolName,
        args: effectiveArgs,
      }
      events.publish(toolStart)

      const tool = toolIndex.get(call.toolName)
      let toolEnd: ToolExecutionEndEvent
      if (!tool) {
        toolEnd = {
          ...baseEventFields(scope),
          type: 'tool_execution_end',
          toolCallId,
          toolName: call.toolName,
          result: { ok: false, error: `unknown tool: ${call.toolName}` },
          isError: true,
          latencyMs: 0,
        }
      } else {
        const startedAt = Date.now()
        try {
          const result = await tool.execute(effectiveArgs, {
            organizationId: opts.organizationId,
            conversationId,
            wakeId,
            agentId: opts.agentId,
            turnIndex,
            toolCallId,
            signal: abortSignal,
          })
          toolEnd = {
            ...baseEventFields(scope),
            type: 'tool_execution_end',
            toolCallId,
            toolName: call.toolName,
            result,
            isError: !result.ok,
            latencyMs: Date.now() - startedAt,
          }
        } catch (err) {
          toolEnd = {
            ...baseEventFields(scope),
            type: 'tool_execution_end',
            toolCallId,
            toolName: call.toolName,
            result: { ok: false, error: err instanceof Error ? err.message : String(err) },
            isError: true,
            latencyMs: Date.now() - startedAt,
          }
        }
      }
      events.publish(toolEnd)
      if (abortSignal?.aborted && abortedAt === null) {
        abortedAt = 'in_tool'
      }
    }

    // message_end
    const msgEnd: MessageEndEvent = {
      ...baseEventFields(scope),
      type: 'message_end',
      messageId,
      role: 'assistant',
      content: assembledContent,
      finishReason,
      tokenCount: assembledContent.length,
    }
    events.publish(msgEnd)

    const turnEnd: TurnEndEvent = {
      ...baseEventFields(scope),
      type: 'turn_end',
      tokensIn: llmEvt.tokensIn,
      tokensOut: assembledContent.length,
      costUsd: 0,
    }
    events.publish(turnEnd)

    // Budget state update and post-turn assessment.
    budgetState.turnsConsumed += 1
    budgetState.spentUsd += llmEvt.costUsd
    if (providerFinish?.inputCostUsd !== undefined && llmEvt.tokensIn > 0) {
      lastCostPerInputToken = providerFinish.inputCostUsd / llmEvt.tokensIn
    }
    if (providerFinish?.outputCostUsd !== undefined && llmEvt.tokensOut > 0) {
      lastCostPerOutputToken = providerFinish.outputCostUsd / llmEvt.tokensOut
    }
    if (
      providerFinish?.inputCostUsd === undefined &&
      providerFinish?.outputCostUsd === undefined &&
      llmEvt.tokensIn + llmEvt.tokensOut > 0
    ) {
      // Provider didn't split — assume 50/50 so worst-case delta stays bounded.
      const halfTotal = llmEvt.costUsd / 2
      if (llmEvt.tokensIn > 0) lastCostPerInputToken = halfTotal / llmEvt.tokensIn
      if (llmEvt.tokensOut > 0) lastCostPerOutputToken = halfTotal / llmEvt.tokensOut
    }
    if (!blocked && opts.iterationBudget) {
      const budgetPhase = assessBudget(opts.iterationBudget, budgetState)
      if (budgetPhase === 'hard') {
        const hardEvt: BudgetWarningEvent = {
          ...baseEventFields(scope),
          type: 'budget_warning',
          phase: 'hard',
          turnsConsumed: budgetState.turnsConsumed,
          spentUsd: budgetState.spentUsd,
        }
        events.publish(hardEvt)
        blocked = { reason: 'budget.hard' }
      } else if (budgetPhase === 'soft') {
        const softEvt: BudgetWarningEvent = {
          ...baseEventFields(scope),
          type: 'budget_warning',
          phase: 'soft',
          turnsConsumed: budgetState.turnsConsumed,
          spentUsd: budgetState.spentUsd,
        }
        events.publish(softEvt)
        budgetWarningSideLoad = `⚠️ Approaching budget limit: ${budgetState.turnsConsumed} of ${opts.iterationBudget.maxTurnsPerWake} turns used. Please wrap up.`
      } else {
        budgetWarningSideLoad = null
      }
    }

    // Roll bash history: snapshot turn N → visible to turn N+1's side-load.
    lastTurnBashCmds = currentTurnBashCmds
    currentTurnBashCmds = []

    // Drain steer queue — accumulated texts will be injected at the next turn's start.
    if (opts.steerQueue) {
      const steers = opts.steerQueue.drain()
      if (steers.length > 0) {
        pendingSteerText = steers.join('\n\n')
      }
    }

    if (abortedAt !== null) {
      const abortedEvt: AgentAbortedEvent = {
        ...baseEventFields(scope),
        type: 'agent_aborted',
        reason: opts.abortCtx?.reason ?? 'external',
        abortedAt,
      }
      events.publish(abortedEvt)
      endReason = 'aborted'
      break
    }

    if (blocked) {
      endReason = 'blocked'
      break
    }
  }

  // agent_end
  const endEvt: AgentEndEvent = {
    ...baseEventFields({ organizationId: opts.organizationId, conversationId, wakeId, turnIndex: 0 }),
    type: 'agent_end',
    reason: endReason,
  }
  events.publish(endEvt)

  // Drain observers + journal writes before returning control.
  unsub()
  await journalChain
  await observers.shutdown()

  // ---- Expose handle for tests ------------------------------------------
  const handle: HarnessHandle = {
    capturedPrompts,
    events: eventLog,
    workspace,
    dirtyTracker,
    simulateToolCall: async (name, args) => {
      // Run through the mutator chain, then the tool, and emit the tool-exec pair.
      const toolCallId = nanoid(10)
      const step: AgentStep = { toolCallId, toolName: name, args }
      const scope: WakeScope = { organizationId: opts.organizationId, conversationId, wakeId, turnIndex: 0 }
      const mutatorCtx: MutatorContext = {
        ...observerCtx,
        llmCall: async () => {
          throw new Error('simulateToolCall: llmCall disallowed')
        },
        persistEvent: async (ev) => {
          eventLog.push(ev)
        },
      }
      const decision = await mutators.runBefore(step, mutatorCtx)
      const eff = decision?.action === 'transform' ? decision.args : args
      const startEv: ToolExecutionStartEvent = {
        ...baseEventFields(scope),
        type: 'tool_execution_start',
        toolCallId,
        toolName: name,
        args: eff,
      }
      eventLog.push(startEv)
      const tool = toolIndex.get(name)
      let endEv: ToolExecutionEndEvent
      if (!tool || decision?.action === 'block') {
        endEv = {
          ...baseEventFields(scope),
          type: 'tool_execution_end',
          toolCallId,
          toolName: name,
          result: {
            ok: false,
            error: decision?.action === 'block' ? decision.reason : `unknown tool: ${name}`,
          },
          isError: true,
          latencyMs: 0,
        }
      } else {
        const t0 = Date.now()
        const result = await tool.execute(eff, {
          organizationId: opts.organizationId,
          conversationId,
          wakeId,
          agentId: opts.agentId,
          turnIndex: 0,
          toolCallId,
        })
        endEv = {
          ...baseEventFields(scope),
          type: 'tool_execution_end',
          toolCallId,
          toolName: name,
          result,
          isError: !result.ok,
          latencyMs: Date.now() - t0,
        }
      }
      eventLog.push(endEv)
    },
    registerSideLoadMaterializer: (m) => {
      customSideLoad.push(m)
    },
    preWakeWrite: async (path, content) => {
      await workspace.innerFs.writeFile(path, content)
    },
  }

  return { harness: handle, conversationId, wakeId }
}

// ----- trigger rendering ---------------------------------------------------

function renderTriggerMessage(trigger: WakeTrigger): string {
  switch (trigger.trigger) {
    case 'inbound_message':
      return `New customer message(s). See /workspace/conversation/messages.md for context.`
    case 'approval_resumed':
      return trigger.decision === 'approved'
        ? `Your previous action was approved. Continue.`
        : `Your previous action was rejected: ${trigger.note ?? '(no note)'}. Choose a different approach.`
    case 'supervisor':
      return `Staff added an internal note. Read /workspace/conversation/internal-notes.md for context.`
    case 'scheduled_followup':
      return `Scheduled follow-up: ${trigger.reason}.`
    case 'manual':
      return `Manual wake: ${trigger.reason}.`
    default: {
      const exhaustive: never = trigger
      return `Unknown trigger: ${String(exhaustive)}`
    }
  }
}

// ----- helper re-exports ---------------------------------------------------

export type { MockStreamEvent, StreamFn }
export { mockStream }
