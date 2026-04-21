/**
 * Wake harness — `bootWake()` entry point, rewritten on top of
 * `@mariozechner/pi-agent-core`'s stateful `Agent` class.
 *
 * Responsibilities (unchanged from the hand-rolled loop):
 *   - Build the frozen system prompt ONCE and never mutate it mid-wake.
 *   - Drain events into our contract `AgentEvent` union (with
 *     `{ts, wakeId, conversationId, organizationId, turnIndex}`).
 *   - Journal events serialized to preserve DB PK order.
 *   - Register built-in + module observers.
 *   - Preserve three-layer byte budget (L1/L2/L3) via the bash tool's
 *     `onSpill` callback and the shared `TurnBudget`.
 *
 * Translation seams (per the authoritative design decisions):
 *   1. `llm_call` event synthesized on pi's `message_end` using
 *      `message.usage` + `Date.now() - turnStartedAt`.
 *   2. Abort phase tracked in a closure flag; on abort we emit `agent_aborted`
 *      with the latest known phase.
 *   3. "Turn" = one `agent.prompt()` call. Side-load cached per user-turn,
 *      reused across pi sub-turns via `transformContext`. Our `turn_start`/
 *      `turn_end` fire at user-turn boundaries only; pi's sub-turn events are
 *      dropped from the contract stream.
 *   4. `messageHistoryObserver` snapshots `agent.state.messages` on our
 *      translated `turn_end`.
 */

import {
  Agent,
  type AgentMessage,
  type AgentToolResult,
  type AgentEvent as PiAgentEvent,
  type AgentTool as PiAgentTool,
} from '@mariozechner/pi-agent-core'
import type { AssistantMessage } from '@mariozechner/pi-ai'
import { Type } from '@mariozechner/pi-ai'
import { createLearningProposalObserver } from '@modules/agents/observers/learning-proposal'
import { createMemoryDistillObserver } from '@modules/agents/observers/memory-distill'
import { createMessageHistoryObserver } from '@modules/agents/observers/message-history-observer'
import { createWorkspaceSyncObserver } from '@modules/agents/observers/workspace-sync'
import type { AgentDefinition } from '@modules/agents/schema'
import { getLastWakeTail } from '@modules/agents/service/journal'
import { loadMessages, resolveThread } from '@modules/agents/service/message-history'
import type { AgentsPort } from '@modules/agents/service/types'
import type { ContactsService } from '@modules/contacts/service/contacts'
import type { FilesService } from '@modules/drive/service/files'
import type { AbortContext } from '@server/contracts/abort-context'
import type {
  AgentAbortedEvent,
  AgentEndEvent,
  AgentEvent,
  AgentStartEvent,
  LlmCallEvent,
  MessageEndEvent,
  MessageStartEvent,
  MessageUpdateEvent,
  SteerInjectedEvent,
  ToolExecutionEndEvent,
  ToolExecutionStartEvent,
  TurnEndEvent,
  TurnStartEvent,
  WakeTrigger,
} from '@server/contracts/event'
import type { IterationBudget } from '@server/contracts/iteration-budget'
import type { AgentMutator, AgentStep, MutatorContext } from '@server/contracts/mutator'
import type { AgentObserver, Logger, ObserverContext } from '@server/contracts/observer'
import type { AgentTool, CommandDef, EventBus, ObserverFactory, PluginContext } from '@server/contracts/plugin-context'
import type { ScopedDb } from '@server/contracts/scoped-db'
import type { SideLoadContributor, WorkspaceMaterializer } from '@server/contracts/side-load'
import type { WakeContext } from '@server/contracts/wake-context'
import { EventBus as DefaultEventBus } from '@server/runtime/event-bus'
import { MutatorChain } from '@server/runtime/mutator-chain'
import { ObserverBus } from '@server/runtime/observer-bus'
import type { SteerQueueHandle } from '@server/runtime/steer-queue'
import { newWakeId } from '@server/runtime/wake-id'
import { createWorkspace, type WorkspaceHandle } from '@server/workspace/create-workspace'
import { DirtyTracker } from '@server/workspace/dirty-tracker'
import { nanoid } from 'nanoid'
import { makeBashTool } from './bash-tool'
import { buildFrozenPrompt } from './frozen-prompt-builder'
import { createModel, resolveApiKey } from './llm-provider'
import { createRestartRecoveryContributor } from './restart-recovery'
import { type CustomSideLoadMaterializer, collectSideLoad, createBashHistoryMaterializer } from './side-load-collector'
import { TurnBudget } from './turn-budget'

// ----- public types --------------------------------------------------------

export interface ModuleRegistrationsSnapshot {
  tools: readonly AgentTool[]
  commands: readonly CommandDef[]
  observers: readonly AgentObserver[]
  observerFactories?: readonly ObserverFactory[]
  mutators: readonly AgentMutator[]
  materializers: readonly WorkspaceMaterializer[]
  sideLoadContributors: readonly SideLoadContributor[]
}

/**
 * Stream-function seam. Accepts any pi-agent-core-compatible `StreamFn`.
 * Use `stubStreamFn(...)` from `tests/helpers/stub-stream.ts` in tests;
 * production boots pi-ai's built-in `streamSimple`.
 */
export type StreamFnLike = ConstructorParameters<typeof Agent>[0] extends infer O
  ? O extends { streamFn?: infer F }
    ? F
    : never
  : never

export interface BootWakeOpts {
  organizationId: string
  agentId: string
  contactId: string
  trigger?: WakeTrigger
  /**
   * Stream function override. When omitted, pi-agent-core boots pi-ai's
   * default `streamSimple` (which requires a real API key). Tests pass
   * `stubStreamFn([...])`.
   */
  streamFn?: StreamFnLike
  /** Model id passed to `createModel`. Defaults to `agentDefinition.model`. */
  model?: string
  registrations: ModuleRegistrationsSnapshot
  ports: {
    agents: AgentsPort
    drive: FilesService
    contacts: ContactsService
  }
  events?: EventBus
  logger?: Logger
  maxTurns?: number
  conversationId?: string
  preWakeWrites?: ReadonlyArray<{ path: string; content: string }>
  observerLlmCall?: PluginContext['llmCall']
  iterationBudget?: IterationBudget
  abortCtx?: AbortContext
  steerQueue?: SteerQueueHandle
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

// ----- internal helpers ----------------------------------------------------

const noopLogger: Logger = {
  debug: () => undefined,
  info: () => undefined,
  warn: () => undefined,
  error: () => undefined,
}

interface WakeScope {
  organizationId: string
  conversationId: string
  wakeId: string
  turnIndex: number
}

function baseFields(scope: WakeScope) {
  return {
    ts: new Date(),
    wakeId: scope.wakeId,
    conversationId: scope.conversationId,
    organizationId: scope.organizationId,
    turnIndex: scope.turnIndex,
  }
}

function renderTriggerMessage(trigger: WakeTrigger): string {
  switch (trigger.trigger) {
    case 'inbound_message':
      return 'New customer message(s). See /workspace/conversation/messages.md for context.'
    case 'approval_resumed':
      return trigger.decision === 'approved'
        ? 'Your previous action was approved. Continue.'
        : `Your previous action was rejected: ${trigger.note ?? '(no note)'}. Choose a different approach.`
    case 'supervisor':
      return 'Staff added an internal note. Read /workspace/conversation/internal-notes.md for context.'
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

function stringifyResult(result: unknown): string {
  if (result === undefined || result === null) return ''
  if (typeof result === 'string') return result
  try {
    return JSON.stringify(result)
  } catch {
    return String(result)
  }
}

function extractAssistantText(msg: AssistantMessage): string {
  const c = msg.content as unknown
  if (!c) return ''
  if (typeof c === 'string') return c
  if (Array.isArray(c)) {
    let out = ''
    for (const block of c as Array<{ type: string; text?: string }>) {
      if (block && block.type === 'text' && typeof block.text === 'string') out += block.text
    }
    return out
  }
  return ''
}

// ----- TurnTracker ---------------------------------------------------------

/**
 * Per-wake state machine translating pi sub-turn events into the contract
 * event sequence. See the file header for design invariants.
 */
class TurnTracker {
  /** User-facing turn index. Starts at -1, increments on each `agent.prompt()`. */
  turnIndex = -1
  /** Side-load text block built once per user-turn, injected via transformContext. */
  sideLoadCache: string | null = null
  /** Abort classification flag — read when emitting `agent_aborted`. */
  phase: 'pre_tool' | 'in_tool' | 'post_tool' = 'pre_tool'
  /** Wall-clock timestamp of the current turn's first LLM call start. */
  turnStartedAt = 0
  /** First transformContext call of a user-turn primes the side-load cache. */
  isFirstTransformOfTurn = true

  beginUserTurn(): void {
    this.turnIndex += 1
    this.sideLoadCache = null
    this.phase = 'pre_tool'
    this.isFirstTransformOfTurn = true
    this.turnStartedAt = Date.now()
  }

  onToolStart(): void {
    this.phase = 'in_tool'
  }

  onToolEnd(): void {
    this.phase = 'post_tool'
  }
}

// ----- tool adapter --------------------------------------------------------

interface TrackerRef {
  current: TurnTracker
  scope: WakeScope
  agentId: string
  approvalDecision?: {
    decision: 'approved' | 'rejected'
    note?: string
    decidedByUserId?: string
  }
}

/**
 * Wrap our contract-style `AgentTool<TArgs, TResult>` into pi's
 * `AgentTool<TSchema>` signature. Tools themselves stay on the contract
 * shape — the adapter closes over the per-wake scope the contract expects.
 */
function adaptToolForPi(tool: AgentTool, ref: TrackerRef): PiAgentTool {
  // Tools author their schemas in TypeBox (or as plain JSON Schema for bash).
  // Either form is AJV-compatible and can be handed to pi-ai verbatim.
  const raw = tool.inputSchema as unknown
  const parameters =
    raw && typeof raw === 'object' && 'type' in (raw as Record<string, unknown>)
      ? (raw as ReturnType<typeof Type.Object>)
      : (Type.Object({}) as ReturnType<typeof Type.Object>)

  const piTool: PiAgentTool = {
    name: tool.name,
    label: tool.name,
    description: tool.description,
    parameters,
    execute: async (toolCallId, params) => {
      const scope = ref.scope
      const result = await tool.execute(params as unknown, {
        organizationId: scope.organizationId,
        conversationId: scope.conversationId,
        wakeId: scope.wakeId,
        agentId: ref.agentId,
        turnIndex: ref.current.turnIndex < 0 ? 0 : ref.current.turnIndex,
        toolCallId,
        approvalDecision: ref.approvalDecision,
      })
      const out: AgentToolResult<unknown> = {
        content: [{ type: 'text', text: stringifyResult(result) }],
        details: result,
      }
      return out
    },
  }
  return piTool
}

// ----- main entry ----------------------------------------------------------

export async function bootWake(opts: BootWakeOpts): Promise<BootWakeResult> {
  const wakeId = newWakeId()
  const conversationId = opts.conversationId ?? nanoid(10)
  const logger = opts.logger ?? noopLogger
  const events = opts.events ?? new DefaultEventBus()

  const agentDefinition: AgentDefinition = await opts.ports.agents.getAgentDefinition(opts.agentId)
  const scope: WakeScope = {
    organizationId: opts.organizationId,
    conversationId,
    wakeId,
    turnIndex: 0,
  }

  // ---- Observer bus ------------------------------------------------------
  // When a scoped db is supplied, observers + mutators that persist (audit,
  // moderation) get a real handle. Without one (pure-unit tests) we install a
  // throw-proxy so accidental writes surface instead of silently no-op'ing.
  const observerDb: ScopedDb =
    opts.db ??
    (new Proxy(
      {},
      {
        get(_t, prop) {
          throw new Error(`harness observer ctx: db.${String(prop)} accessed but not wired`)
        },
      },
    ) as never)
  const observerCtx: ObserverContext = {
    organizationId: opts.organizationId,
    conversationId,
    wakeId,
    db: observerDb,
    logger,
    realtime: { notify: () => undefined, subscribe: () => () => {} },
  }
  const observers = new ObserverBus({ logger, observerCtx })
  for (const obs of opts.registrations.observers) observers.register(obs)

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
  const piMessages: AgentMessage[] = []
  let historyEnabled = false
  if (opts.db) {
    try {
      const threadId = await resolveThread(opts.db, { agentId: opts.agentId, conversationId })
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

  // Bridge EventBus → ObserverBus + journal (serialized for PK order).
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
    createWorkspaceSyncObserver({
      fs: workspace.innerFs,
      tracker: dirtyTracker,
      contactId: opts.contactId,
      drive: opts.ports.drive,
    }),
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

  for (const w of opts.preWakeWrites ?? []) {
    await workspace.innerFs.writeFile(w.path, w.content)
  }

  const turnBudget = new TurnBudget()
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

  const mutators = new MutatorChain(opts.registrations.mutators)
  const capturedPrompts: CapturedPrompt[] = []
  const customSideLoad: CustomSideLoadMaterializer[] = []
  const bashHistory: { last: string[]; current: string[] } = { last: [], current: [] }
  customSideLoad.push(createBashHistoryMaterializer(() => bashHistory.last))
  customSideLoad.push(createRestartRecoveryContributor(conversationId, getLastWakeTail))

  // ---- Frozen prompt (ONCE) ---------------------------------------------
  const frozen = await buildFrozenPrompt({
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

  // ---- Emit agent_start --------------------------------------------------
  const startEvt: AgentStartEvent = {
    ...baseFields(scope),
    type: 'agent_start',
    agentId: opts.agentId,
    trigger: trigger.trigger,
    triggerPayload: trigger,
    systemHash: frozen.systemHash,
  }
  events.publish(startEvt)

  // ---- Build Agent + translation layer ----------------------------------
  const tracker = new TurnTracker()
  const trackerRef: TrackerRef = {
    current: tracker,
    scope,
    agentId: opts.agentId,
    approvalDecision:
      trigger.trigger === 'approval_resumed' ? { decision: trigger.decision, note: trigger.note } : undefined,
  }

  const piTools: PiAgentTool[] = []
  for (const t of toolIndex.values()) piTools.push(adaptToolForPi(t, trackerRef))

  const model = createModel(opts.model ?? agentDefinition.model)
  const modelId = model.id
  const providerName = model.provider

  let currentMessageId: string | null = null
  let assembledContent = ''
  let firstSubTurnOfUserTurn = true
  // Aggregated per user-turn; reset in the outer loop at `beginUserTurn`.
  let turnTokensIn = 0
  let turnTokensOut = 0
  let turnCostUsd = 0

  const agentOpts: ConstructorParameters<typeof Agent>[0] = {
    initialState: {
      systemPrompt: frozen.system,
      model,
      tools: piTools,
      thinkingLevel: 'off',
    },
    convertToLlm: (msgs: AgentMessage[]) => msgs as never,
    transformContext: async (msgs: AgentMessage[]) => {
      if (tracker.isFirstTransformOfTurn) {
        tracker.isFirstTransformOfTurn = false
        const sideLoadBody = await collectSideLoad({
          ctx: {
            organizationId: opts.organizationId,
            conversationId,
            agentId: opts.agentId,
            contactId: opts.contactId,
            turnIndex: Math.max(0, tracker.turnIndex),
          },
          contributors: opts.registrations.sideLoadContributors,
          customMaterializers: customSideLoad,
          bash: workspace.bash,
        })
        tracker.sideLoadCache = sideLoadBody
      }
      if (!tracker.sideLoadCache) return msgs
      const lastIdx = msgs.length - 1
      const last = msgs[lastIdx]
      if (!last || last.role !== 'user') return msgs
      const userText = typeof last.content === 'string' ? last.content : ''
      const withSideLoad: AgentMessage = {
        ...last,
        content: `${tracker.sideLoadCache}\n\n${userText}`,
      }
      const out = msgs.slice(0, lastIdx)
      out.push(withSideLoad)
      return out
    },
    getApiKey: () => resolveApiKey(),
    beforeToolCall: async (ctx) => {
      const step: AgentStep = {
        toolCallId: ctx.toolCall.id,
        toolName: ctx.toolCall.name,
        args: ctx.args,
      }
      const mutatorCtx: MutatorContext = {
        ...observerCtx,
        llmCall:
          opts.observerLlmCall ??
          (async () => {
            throw new Error('mutator invoked llmCall but bootWake was not supplied with `observerLlmCall`')
          }),
        persistEvent: async (ev) => {
          events.publish(ev)
        },
      }
      const decision = await mutators.runBefore(step, mutatorCtx)
      if (decision?.action === 'block') {
        return { block: true, reason: decision.reason }
      }
      return undefined
    },
    afterToolCall: async () => undefined,
  }
  if (opts.streamFn) {
    // Narrow: pi's streamFn type is the same TSchema we pipe through.
    ;(agentOpts as { streamFn?: unknown }).streamFn = opts.streamFn
  }

  const agent = new Agent(agentOpts)

  // ---- Subscribe: pi events → contract events ---------------------------
  agent.subscribe((piEv: PiAgentEvent) => {
    const curScope: WakeScope = { ...scope, turnIndex: Math.max(0, tracker.turnIndex) }
    switch (piEv.type) {
      case 'turn_start': {
        if (firstSubTurnOfUserTurn) {
          firstSubTurnOfUserTurn = false
          const ev: TurnStartEvent = { ...baseFields(curScope), type: 'turn_start' }
          events.publish(ev)
          turnBudget.reset()
        }
        break
      }
      case 'message_start': {
        // Pi fires message_start for every message added to the transcript
        // (user, tool-result, assistant). Only the assistant message maps to
        // our contract `message_start` / `llm_call` pair.
        if (piEv.message.role !== 'assistant') break
        currentMessageId = nanoid(10)
        assembledContent = ''
        const ev: MessageStartEvent = {
          ...baseFields(curScope),
          type: 'message_start',
          messageId: currentMessageId,
          role: 'assistant',
        }
        events.publish(ev)
        break
      }
      case 'message_update': {
        if (!currentMessageId) break
        if (piEv.message.role !== 'assistant') break
        const pev = piEv.assistantMessageEvent
        if (pev.type === 'text_delta') {
          assembledContent += pev.delta
          const ev: MessageUpdateEvent = {
            ...baseFields(curScope),
            type: 'message_update',
            messageId: currentMessageId,
            delta: pev.delta,
          }
          events.publish(ev)
        }
        break
      }
      case 'message_end': {
        if (!currentMessageId) break
        if (piEv.message.role !== 'assistant') break
        const assistant = piEv.message as AssistantMessage
        const finishReason = typeof assistant.stopReason === 'string' ? assistant.stopReason : 'stop'
        const usage = assistant.usage

        // Synthesize our llm_call on pi's message_end.
        const callTokensIn = usage?.input ?? 0
        const callTokensOut = usage?.output ?? 0
        const callCost = usage?.cost?.total ?? 0
        turnTokensIn += callTokensIn
        turnTokensOut += callTokensOut
        turnCostUsd += callCost
        const llmEvt: LlmCallEvent = {
          ...baseFields(curScope),
          type: 'llm_call',
          task: 'agent.turn',
          model: modelId,
          provider: providerName,
          tokensIn: callTokensIn,
          tokensOut: callTokensOut,
          cacheReadTokens: usage?.cacheRead ?? 0,
          costUsd: callCost,
          latencyMs: Date.now() - tracker.turnStartedAt,
          cacheHit: (usage?.cacheRead ?? 0) > 0,
        }
        events.publish(llmEvt)

        const textContent = assembledContent || extractAssistantText(assistant)
        const ev: MessageEndEvent = {
          ...baseFields(curScope),
          type: 'message_end',
          messageId: currentMessageId,
          role: 'assistant',
          content: textContent,
          finishReason,
          tokenCount: textContent.length,
        }
        events.publish(ev)
        break
      }
      case 'tool_execution_start': {
        tracker.onToolStart()
        if (piEv.toolName === 'bash') {
          const cmd = (piEv.args as { command?: string } | null | undefined)?.command
          if (typeof cmd === 'string' && cmd.length > 0) bashHistory.current.push(cmd)
        }
        const ev: ToolExecutionStartEvent = {
          ...baseFields(curScope),
          type: 'tool_execution_start',
          toolCallId: piEv.toolCallId,
          toolName: piEv.toolName,
          args: piEv.args,
        }
        events.publish(ev)
        break
      }
      case 'tool_execution_end': {
        tracker.onToolEnd()
        const pr = piEv.result as AgentToolResult<unknown> | undefined
        // On validation/prepare failures pi synthesizes `{ content: [{text: <msg>}], details: {} }`
        // with isError=true. Pulling only `details` there yields `{}` and drops the error text.
        // Prefer `details` when the tool executed successfully; fall back to the text content
        // when pi is signalling a failure, so the message reaches the logs and the LLM.
        const detailsValue = pr?.details
        const detailsPresent =
          detailsValue !== undefined &&
          !(typeof detailsValue === 'object' && detailsValue !== null && Object.keys(detailsValue).length === 0)
        let ourResult: unknown = detailsPresent ? detailsValue : pr
        if (piEv.isError) {
          const text = pr?.content?.find((c): c is { type: 'text'; text: string } => c.type === 'text')?.text
          if (text) ourResult = { ok: false, error: text }
        }
        const ev: ToolExecutionEndEvent = {
          ...baseFields(curScope),
          type: 'tool_execution_end',
          toolCallId: piEv.toolCallId,
          toolName: piEv.toolName,
          result: ourResult,
          isError: Boolean(piEv.isError),
          latencyMs: 0,
        }
        events.publish(ev)
        break
      }
      default:
        // `agent_start`, `agent_end`, `turn_end`, `tool_execution_update` —
        // we emit our own turn-bracketing events from the main loop.
        break
    }
  })

  // ---- Run user-turns ----------------------------------------------------
  const maxTurns = opts.iterationBudget?.maxTurnsPerWake ?? opts.maxTurns ?? 1
  const abortSignal = opts.abortCtx?.wakeAbort.signal
  let endReason: AgentEndEvent['reason'] = 'complete'
  let pendingSteerText: string | null = null

  if (abortSignal) {
    abortSignal.addEventListener('abort', () => {
      try {
        agent.abort()
      } catch {
        /* agent may already be idle */
      }
    })
  }

  // A "user turn" is one `agent.prompt()` call. pi-agent-core's inner loop
  // already handles multi-step tool use, so we only iterate this outer loop
  // again when there's a pending steer to inject ahead of the next prompt.
  for (let t = 0; t < maxTurns; t += 1) {
    if (t > 0 && pendingSteerText === null) break
    tracker.beginUserTurn()
    firstSubTurnOfUserTurn = true
    turnTokensIn = 0
    turnTokensOut = 0
    turnCostUsd = 0
    const curScope: WakeScope = { ...scope, turnIndex: tracker.turnIndex }

    let userText = renderTriggerMessage(trigger)
    if (pendingSteerText !== null) {
      const steerEvt: SteerInjectedEvent = {
        ...baseFields(curScope),
        type: 'steer_injected',
        text: pendingSteerText,
      }
      events.publish(steerEvt)
      userText = `${pendingSteerText}\n\n${userText}`
      pendingSteerText = null
    }

    // Build captured-prompts snapshot (mirrors what transformContext will see).
    const sideLoadBody = await collectSideLoad({
      ctx: {
        organizationId: opts.organizationId,
        conversationId,
        agentId: opts.agentId,
        contactId: opts.contactId,
        turnIndex: tracker.turnIndex,
      },
      contributors: opts.registrations.sideLoadContributors,
      customMaterializers: customSideLoad,
      bash: workspace.bash,
    })
    const firstUserMessage = sideLoadBody ? `${sideLoadBody}\n\n${userText}` : userText
    capturedPrompts.push({
      system: frozen.system,
      systemHash: frozen.systemHash,
      firstUserMessage,
    })

    try {
      await agent.prompt(userText)
      await agent.waitForIdle()
    } catch (err) {
      logger.error({ err }, 'agent.prompt failed')
      endReason = 'error'
      break
    }

    const turnEnd: TurnEndEvent = {
      ...baseFields(curScope),
      type: 'turn_end',
      tokensIn: turnTokensIn,
      tokensOut: turnTokensOut,
      costUsd: turnCostUsd,
    }
    events.publish(turnEnd)

    if (historyEnabled) {
      piMessages.length = 0
      for (const m of agent.state.messages) piMessages.push(m)
    }

    bashHistory.last = bashHistory.current
    bashHistory.current = []

    if (abortSignal?.aborted || agent.state.errorMessage) {
      const abortedEvt: AgentAbortedEvent = {
        ...baseFields(curScope),
        type: 'agent_aborted',
        reason: opts.abortCtx?.reason ?? agent.state.errorMessage ?? 'external',
        abortedAt: tracker.phase,
      }
      events.publish(abortedEvt)
      endReason = 'aborted'
      break
    }

    if (opts.steerQueue) {
      const steers = opts.steerQueue.drain()
      if (steers.length > 0) pendingSteerText = steers.join('\n\n')
    }
  }

  const endEvt: AgentEndEvent = {
    ...baseFields({ ...scope, turnIndex: Math.max(0, tracker.turnIndex) }),
    type: 'agent_end',
    reason: endReason,
  }
  events.publish(endEvt)

  unsub()
  await journalChain
  await observers.shutdown()

  const handle: HarnessHandle = {
    capturedPrompts,
    events: eventLog,
    workspace,
    dirtyTracker,
    simulateToolCall: async (name, args) => {
      const toolCallId = nanoid(10)
      const step: AgentStep = { toolCallId, toolName: name, args }
      const curScope: WakeScope = { ...scope, turnIndex: 0 }
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
        ...baseFields(curScope),
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
          ...baseFields(curScope),
          type: 'tool_execution_end',
          toolCallId,
          toolName: name,
          result: { ok: false, error: decision?.action === 'block' ? decision.reason : `unknown tool: ${name}` },
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
          ...baseFields(curScope),
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
