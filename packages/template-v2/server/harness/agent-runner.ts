/**
 * Wake harness — the core `bootWake()` entry point.
 *
 * Drives the full event lifecycle (spec §8.2):
 *   `agent_start` → `turn_start` → `llm_call` → `message_start` →
 *   `message_update*` (≥1) → `message_end` → `turn_end` → `agent_end`
 *
 * Every event fans out through `ctx.events.publish(event)` so `ObserverBus`
 * observers AND the journal (`agents.service.journal.append`) receive them.
 * Tool calls run through the mutator chain (approvalMutator etc.).
 */

import { createMemoryDistillObserver } from '@modules/agents/observers/memory-distill'
import { createWorkspaceSyncObserver } from '@modules/agents/observers/workspace-sync'
import type { AgentsPort } from '@server/contracts/agents-port'
import type { ContactsPort } from '@server/contracts/contacts-port'
import type { AgentDefinition } from '@server/contracts/domain-types'
import type { DrivePort } from '@server/contracts/drive-port'
import type {
  AgentEndEvent,
  AgentEvent,
  AgentStartEvent,
  LlmCallEvent,
  MessageEndEvent,
  MessageStartEvent,
  MessageUpdateEvent,
  ToolExecutionEndEvent,
  ToolExecutionStartEvent,
  TurnEndEvent,
  TurnStartEvent,
  WakeTrigger,
} from '@server/contracts/event'
import type { AgentMutator, AgentStep, MutatorContext } from '@server/contracts/mutator'
import type { AgentObserver, Logger, ObserverContext } from '@server/contracts/observer'
import type { AgentTool, CommandDef, EventBus, LlmRequest } from '@server/contracts/plugin-context'
import type { LlmFinish, LlmProvider } from '@server/contracts/provider-port'
import type { SideLoadContributor, WorkspaceMaterializer } from '@server/contracts/side-load'
import { EventBus as DefaultEventBus } from '@server/runtime/event-bus'
import { newWakeId } from '@server/runtime/llm-call'
import { MutatorChain } from '@server/runtime/mutator-chain'
import { ObserverBus } from '@server/runtime/observer-bus'
import { createWorkspace, type WorkspaceHandle } from '@server/workspace/create-workspace'
import { DirtyTracker } from '@server/workspace/dirty-tracker'
import { nanoid } from 'nanoid'
import { drainProviderTurn } from './agent-adapter'
import { makeBashTool } from './bash-tool'
import { buildFrozenPrompt } from './frozen-prompt-builder'
import { type MockStreamEvent, mockStream, type StreamFn } from './mock-stream'
import { type CustomSideLoadMaterializer, collectSideLoad } from './side-load-collector'

// ----- types ---------------------------------------------------------------

export interface ModuleRegistrationsSnapshot {
  tools: readonly AgentTool[]
  commands: readonly CommandDef[]
  observers: readonly AgentObserver[]
  mutators: readonly AgentMutator[]
  materializers: readonly WorkspaceMaterializer[]
  sideLoadContributors: readonly SideLoadContributor[]
}

export interface BootWakeOpts {
  tenantId: string
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
  tenantId: string
  conversationId: string
  wakeId: string
  turnIndex: number
}

function baseEventFields(scope: WakeScope) {
  return {
    ts: new Date(),
    wakeId: scope.wakeId,
    conversationId: scope.conversationId,
    tenantId: scope.tenantId,
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
  const observerCtx: ObserverContext = {
    tenantId: opts.tenantId,
    conversationId,
    wakeId,
    ports: {
      inbox: null as never,
      contacts: opts.ports.contacts,
      drive: opts.ports.drive,
      agents: opts.ports.agents,
      caption: null as never,
    },
    db: null as never,
    logger,
    realtime: { notify: () => undefined },
  }
  const observers = new ObserverBus({ logger, observerCtx })
  for (const obs of opts.registrations.observers) observers.register(obs)

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
    tenantId: opts.tenantId,
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
  observers.register(createMemoryDistillObserver({ contactId: opts.contactId }))

  // Apply any pre-wake writes the caller staged (test harness).
  for (const w of opts.preWakeWrites ?? []) {
    await workspace.innerFs.writeFile(w.path, w.content)
  }

  // Build the single bash tool (and allow mutator/tool-result hydration later).
  const bashTool = makeBashTool({
    bash: workspace.bash,
    innerWrite: async (path, content) => {
      await workspace.innerFs.writeFile(path, content)
    },
  })
  const toolIndex = new Map<string, AgentTool>()
  toolIndex.set('bash', bashTool as unknown as AgentTool)
  for (const t of opts.registrations.tools) toolIndex.set(t.name, t)

  // ---- Mutator chain -----------------------------------------------------
  const mutators = new MutatorChain(opts.registrations.mutators)
  const capturedPrompts: CapturedPrompt[] = []
  const customSideLoad: CustomSideLoadMaterializer[] = []

  // ---- Emit agent_start --------------------------------------------------
  const frozen0 = await buildFrozenPrompt({
    bash: workspace.bash,
    agentDefinition,
    tenantId: opts.tenantId,
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
    ...baseEventFields({ tenantId: opts.tenantId, conversationId, wakeId, turnIndex: 0 }),
    type: 'agent_start',
    agentId: opts.agentId,
    trigger: trigger.trigger,
    triggerPayload: trigger,
    systemHash: frozen0.systemHash,
  }
  events.publish(startEvt)

  // ---- Turn loop ---------------------------------------------------------
  const maxTurns = opts.maxTurns ?? 1
  let endReason: AgentEndEvent['reason'] = 'complete'

  for (let turnIndex = 0; turnIndex < maxTurns; turnIndex += 1) {
    const scope: WakeScope = { tenantId: opts.tenantId, conversationId, wakeId, turnIndex }

    // turn_start
    const turnStart: TurnStartEvent = { ...baseEventFields(scope), type: 'turn_start' }
    events.publish(turnStart)

    // Rebuild side-load FRESH each turn so mid-wake writes propagate (spec §2.2).
    const sideLoadBody = await collectSideLoad({
      ctx: {
        tenantId: opts.tenantId,
        conversationId,
        agentId: opts.agentId,
        contactId: opts.contactId,
        turnIndex,
      },
      contributors: opts.registrations.sideLoadContributors,
      customMaterializers: customSideLoad,
      bash: workspace.bash,
    })
    const firstUserMessage = sideLoadBody
      ? `${sideLoadBody}\n\n${renderTriggerMessage(trigger)}`
      : renderTriggerMessage(trigger)

    // Frozen prompt is computed ONCE — reuse the turn-0 snapshot for subsequent turns.
    capturedPrompts.push({
      system: frozen0.system,
      systemHash: frozen0.systemHash,
      firstUserMessage,
    })

    const pending: MockStreamEvent[] = []
    let providerFinish: LlmFinish | undefined
    if (opts.provider) {
      const req: LlmRequest = {
        model: opts.model ?? agentDefinition.model,
        system: frozen0.system,
        messages: [{ role: 'user', content: firstUserMessage }],
        tools: Array.from(toolIndex.values()),
        stream: true,
      }
      const drained = await drainProviderTurn(opts.provider, req)
      providerFinish = drained.finish
      for (const ev of drained.events) pending.push(ev)
    } else if (opts.mockStreamFn) {
      const streamGen = opts.mockStreamFn()
      for await (const ev of streamGen) pending.push(ev)
    } else {
      throw new Error('bootWake: either `provider` or `mockStreamFn` must be supplied')
    }

    const providerName = opts.provider?.name ?? 'mock'
    const modelId = opts.model ?? (opts.provider ? agentDefinition.model : 'mock-llm')

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
    for (const call of toolCalls) {
      const toolCallId = call.toolCallId ?? nanoid(10)
      const step: AgentStep = { toolCallId, toolName: call.toolName, args: call.args }
      const mutatorCtx: MutatorContext = {
        ...observerCtx,
        db: null as never,
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
            tenantId: opts.tenantId,
            conversationId,
            wakeId,
            agentId: opts.agentId,
            turnIndex,
            toolCallId,
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

    if (blocked) {
      endReason = 'blocked'
      break
    }
  }

  // agent_end
  const endEvt: AgentEndEvent = {
    ...baseEventFields({ tenantId: opts.tenantId, conversationId, wakeId, turnIndex: 0 }),
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
      const scope: WakeScope = { tenantId: opts.tenantId, conversationId, wakeId, turnIndex: 0 }
      const mutatorCtx: MutatorContext = {
        ...observerCtx,
        db: null as never,
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
          tenantId: opts.tenantId,
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

// ----- helper re-exports for Lane F ---------------------------------------

export type { MockStreamEvent, StreamFn }
export { mockStream }
