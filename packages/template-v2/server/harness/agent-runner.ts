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

import type { AgentMessage } from '@mariozechner/pi-agent-core'
import { createLearningProposalObserver } from '@modules/agents/observers/learning-proposal'
import { createMemoryDistillObserver } from '@modules/agents/observers/memory-distill'
import { createMessageHistoryObserver } from '@modules/agents/observers/message-history-observer'
import { createWorkspaceSyncObserver } from '@modules/agents/observers/workspace-sync'
import { getLastWakeTail } from '@modules/agents/service/journal'
import { loadMessages, resolveThread } from '@modules/agents/service/message-history'
import type { ContactsService } from '@modules/contacts/service/contacts'
import type { AbortContext } from '@server/contracts/abort-context'
import type { AgentsPort } from '@server/contracts/agents-port'
import type { AgentDefinition } from '@server/contracts/domain-types'
import type { DrivePort } from '@server/contracts/drive-port'
import type {
  AgentEndEvent,
  AgentEvent,
  AgentStartEvent,
  ToolExecutionEndEvent,
  ToolExecutionStartEvent,
  WakeTrigger,
} from '@server/contracts/event'
import type { IterationBudget } from '@server/contracts/iteration-budget'
import type { AgentMutator, AgentStep, MutatorContext } from '@server/contracts/mutator'
import type { AgentObserver, Logger, ObserverContext } from '@server/contracts/observer'
import type { AgentTool, CommandDef, EventBus, ObserverFactory, PluginContext } from '@server/contracts/plugin-context'
import type { LlmProvider } from '@server/contracts/provider-port'
import type { ScopedDb } from '@server/contracts/scoped-db'
import type { SideLoadContributor, WorkspaceMaterializer } from '@server/contracts/side-load'
import type { WakeContext } from '@server/contracts/wake-context'
import { EventBus as DefaultEventBus } from '@server/runtime/event-bus'
import { newWakeId } from '@server/runtime/llm-call'
import { MutatorChain } from '@server/runtime/mutator-chain'
import { ObserverBus } from '@server/runtime/observer-bus'
import type { SteerQueueHandle } from '@server/runtime/steer-queue'
import { createWorkspace, type WorkspaceHandle } from '@server/workspace/create-workspace'
import { DirtyTracker } from '@server/workspace/dirty-tracker'
import { nanoid } from 'nanoid'
import { makeBashTool } from './bash-tool'
import { buildFrozenPrompt } from './frozen-prompt-builder'
import { type MockStreamEvent, mockStream, type StreamFn } from './mock-stream'
import { createRestartRecoveryContributor } from './restart-recovery'
import { type CustomSideLoadMaterializer, createBashHistoryMaterializer } from './side-load-collector'
import { TurnBudget } from './turn-budget'
import { type BashHistoryRef, type BudgetWarningRef, runTurnLoop } from './turn-loop'

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
    contacts: ContactsService
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
  /**
   * Drizzle handle for persisting pi AgentMessage[] history to agents.messages.
   * When provided, a `createMessageHistoryObserver` is registered automatically.
   * When absent (unit tests / mock path), message history is silently skipped.
   */
  db?: ScopedDb
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

  // ---- Message history state --------------------------------------------
  // Shadow-built pi AgentMessage[] mirror of the transcript. The hand-rolled
  // turn loop appends UserMessage/AssistantMessage/ToolResultMessage entries
  // in-place so the history observer can persist them on `turn_end`. Stays a
  // local no-op when `opts.db` is absent (unit-test seams).
  const piMessages: AgentMessage[] = []
  let historyEnabled = false
  if (opts.db) {
    try {
      const threadId = await resolveThread(opts.db, {
        agentId: opts.agentId,
        conversationId,
      })
      const historyMessages = await loadMessages(opts.db, threadId)
      for (const m of historyMessages) piMessages.push(m)
      observers.register(
        createMessageHistoryObserver({
          db: opts.db,
          threadId,
          getMessages: () => piMessages,
          initialSeq: historyMessages.length,
        }),
      )
      historyEnabled = true
    } catch (err) {
      logger.warn({ err }, 'bootWake: message history setup failed — continuing without persistence')
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
  const bashHistory: BashHistoryRef = { last: [], current: [] }
  const budgetWarning: BudgetWarningRef = { value: null }
  customSideLoad.push(createBashHistoryMaterializer(() => bashHistory.last))
  customSideLoad.push(createRestartRecoveryContributor(conversationId, getLastWakeTail))
  if (opts.iterationBudget) {
    customSideLoad.push({
      kind: 'custom',
      priority: 90,
      contribute: () => budgetWarning.value ?? '',
    })
  }

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

  // ---- Turn loop (delegated) --------------------------------------------
  const maxTurns = opts.iterationBudget?.maxTurnsPerWake ?? opts.maxTurns ?? 1
  const endReason = await runTurnLoop({
    opts: {
      organizationId: opts.organizationId,
      agentId: opts.agentId,
      contactId: opts.contactId,
      trigger,
      mockStreamFn: opts.mockStreamFn,
      provider: opts.provider,
      model: opts.model,
      iterationBudget: opts.iterationBudget,
      abortCtx: opts.abortCtx,
      steerQueue: opts.steerQueue,
      maxTurns,
      sideLoadContributors: opts.registrations.sideLoadContributors,
      ports: { agents: opts.ports.agents, drive: opts.ports.drive },
    },
    conversationId,
    wakeId,
    logger,
    agentDefinition,
    events,
    observerCtx,
    mutators,
    toolIndex,
    turnBudget,
    workspaceBash: workspace.bash,
    frozen0,
    capturedPrompts,
    customSideLoad,
    bashHistory,
    budgetWarning,
    piMessages,
    historyEnabled,
  })

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

// ----- helper re-exports ---------------------------------------------------

export type { MockStreamEvent, StreamFn }
export { mockStream }
