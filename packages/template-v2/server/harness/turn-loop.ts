/**
 * Turn loop — the per-turn hand-rolled state machine extracted from bootWake.
 *
 * Owns the loop that runs between `agent_start` and `agent_end`:
 *   turn_start → llm_call → message_start → message_update* → message_end
 *   → (tool_execution_start → tool_execution_end)* → turn_end
 *
 * Pure code motion — behavior is identical to the inline loop it replaced. A
 * future commit will swap the body for a single `agentLoop()` call from
 * `@mariozechner/pi-agent-core`; the file split gives that swap a clean seam.
 *
 * Shared mutable state that must survive between the caller and this loop
 * (`bashHistory`, `budgetWarningSideLoad`) is passed via ref objects so the
 * side-load closures registered by bootWake see updates the loop makes.
 */

import type { AgentMessage } from '@mariozechner/pi-agent-core'
import type { AbortContext } from '@server/contracts/abort-context'
import type { AgentsPort } from '@server/contracts/agents-port'
import type { AgentDefinition } from '@server/contracts/domain-types'
import type { DrivePort } from '@server/contracts/drive-port'
import type {
  AgentAbortedEvent,
  AgentEndEvent,
  BudgetWarningEvent,
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
import type { BudgetState, IterationBudget } from '@server/contracts/iteration-budget'
import type { AgentStep, MutatorContext } from '@server/contracts/mutator'
import type { Logger, ObserverContext } from '@server/contracts/observer'
import type { AgentTool, EventBus, LlmRequest } from '@server/contracts/plugin-context'
import type { LlmFinish, LlmProvider } from '@server/contracts/provider-port'
import type { SideLoadContributor } from '@server/contracts/side-load'
import { assessBudget, worstCaseDeltaExceeds } from '@server/runtime/iteration-budget-runtime'
import type { MutatorChain } from '@server/runtime/mutator-chain'
import { makeResilientProvider } from '@server/runtime/resilient-provider'
import type { SteerQueueHandle } from '@server/runtime/steer-queue'
import type { Bash } from 'just-bash'
import { nanoid } from 'nanoid'
import { drainProviderTurn } from './agent-adapter'
import type { BashToolArgs } from './bash-tool'
import type { MockStreamEvent, StreamFn } from './mock-stream'
import { type CustomSideLoadMaterializer, collectSideLoad } from './side-load-collector'
import type { TurnBudget } from './turn-budget'

// ----- shared types --------------------------------------------------------

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

/** Mutable bash-history ref shared with the bootWake side-load materializer. */
export interface BashHistoryRef {
  last: string[]
  current: string[]
}

/** Mutable string ref for the budget-warning side-load line. */
export interface BudgetWarningRef {
  value: string | null
}

export interface CapturedPrompt {
  system: string
  systemHash: string
  firstUserMessage: string
}

export interface TurnLoopOpts {
  organizationId: string
  agentId: string
  contactId: string
  trigger: WakeTrigger
  mockStreamFn?: StreamFn
  provider?: LlmProvider
  model?: string
  iterationBudget?: IterationBudget
  abortCtx?: AbortContext
  steerQueue?: SteerQueueHandle
  maxTurns: number
  sideLoadContributors: readonly SideLoadContributor[]
  ports: {
    agents: AgentsPort
    drive: DrivePort
  }
}

export interface RunTurnLoopArgs {
  opts: TurnLoopOpts
  conversationId: string
  wakeId: string
  logger: Logger
  agentDefinition: AgentDefinition
  events: EventBus
  observerCtx: ObserverContext
  mutators: MutatorChain
  toolIndex: Map<string, AgentTool>
  turnBudget: TurnBudget
  workspaceBash: Bash
  frozen0: { system: string; systemHash: string }
  capturedPrompts: CapturedPrompt[]
  customSideLoad: CustomSideLoadMaterializer[]
  bashHistory: BashHistoryRef
  budgetWarning: BudgetWarningRef
  piMessages: AgentMessage[]
  historyEnabled: boolean
}

// ----- entry ---------------------------------------------------------------

export async function runTurnLoop(args: RunTurnLoopArgs): Promise<AgentEndEvent['reason']> {
  const {
    opts,
    conversationId,
    wakeId,
    logger,
    agentDefinition,
    events,
    observerCtx,
    mutators,
    toolIndex,
    turnBudget,
    workspaceBash,
    frozen0,
    capturedPrompts,
    customSideLoad,
    bashHistory,
    budgetWarning,
    piMessages,
    historyEnabled,
  } = args

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

  const budgetState: BudgetState = { turnsConsumed: 0, spentUsd: 0 }
  let lastCostPerInputToken = 0
  let lastCostPerOutputToken = 0

  for (let turnIndex = 0; turnIndex < opts.maxTurns; turnIndex += 1) {
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

    // Rebuild side-load FRESH each turn so mid-wake writes propagate (frozen-snapshot invariant).
    const sideLoadBody = await collectSideLoad({
      ctx: {
        organizationId: opts.organizationId,
        conversationId,
        agentId: opts.agentId,
        contactId: opts.contactId,
        turnIndex,
      },
      contributors: opts.sideLoadContributors,
      customMaterializers: customSideLoad,
      bash: workspaceBash,
    })
    let firstUserMessage = sideLoadBody
      ? `${sideLoadBody}\n\n${renderTriggerMessage(opts.trigger)}`
      : renderTriggerMessage(opts.trigger)

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

    capturedPrompts.push({
      system: frozen0.system,
      systemHash: frozen0.systemHash,
      firstUserMessage,
    })

    if (historyEnabled) {
      const userMsg: Extract<AgentMessage, { role: 'user' }> = {
        role: 'user',
        content: firstUserMessage,
        timestamp: Date.now(),
      }
      piMessages.push(userMsg)
    }

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

    const messageId = nanoid(10)
    const msgStart: MessageStartEvent = {
      ...baseEventFields(scope),
      type: 'message_start',
      messageId,
      role: 'assistant',
    }
    events.publish(msgStart)

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

    const finish = pending.find((e) => e.type === 'finish')
    const finishReason = finish ? (finish as { finishReason: string }).finishReason : 'stop'

    const toolCalls = pending.filter((e) => e.type === 'tool-call') as Array<
      Extract<MockStreamEvent, { type: 'tool-call' }>
    >
    let blocked: { reason: string } | null = null
    let abortedAt: 'pre_tool' | 'in_tool' | 'post_tool' | null = null
    if (providerStreamAborted || abortSignal?.aborted) {
      abortedAt = 'pre_tool'
    }
    const turnToolCallBlocks: Array<{ id: string; name: string; args: Record<string, unknown> }> = []
    const turnToolResults: Array<Extract<AgentMessage, { role: 'toolResult' }>> = []
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
        if (typeof cmd === 'string' && cmd.length > 0) bashHistory.current.push(cmd)
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
      if (historyEnabled) {
        const safeArgs =
          effectiveArgs && typeof effectiveArgs === 'object'
            ? (effectiveArgs as Record<string, unknown>)
            : { value: effectiveArgs as unknown }
        turnToolCallBlocks.push({ id: toolCallId, name: call.toolName, args: safeArgs })
        turnToolResults.push({
          role: 'toolResult',
          toolCallId,
          toolName: call.toolName,
          content: [{ type: 'text', text: stringifyToolResult(toolEnd.result) }],
          isError: toolEnd.isError,
          timestamp: Date.now(),
        })
      }
      if (abortSignal?.aborted && abortedAt === null) {
        abortedAt = 'in_tool'
      }
    }

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

    if (historyEnabled) {
      type AssistantAgentMessage = Extract<AgentMessage, { role: 'assistant' }>
      const assistantContent: AssistantAgentMessage['content'] = []
      if (assembledContent.length > 0) {
        assistantContent.push({ type: 'text', text: assembledContent })
      }
      for (const b of turnToolCallBlocks) {
        assistantContent.push({ type: 'toolCall', id: b.id, name: b.name, arguments: b.args })
      }
      const assistantMsg: AssistantAgentMessage = {
        role: 'assistant',
        content: assistantContent,
        api: 'anthropic-messages',
        provider: providerName,
        model: modelId,
        usage: {
          input: providerFinish?.tokensIn ?? 0,
          output: providerFinish?.tokensOut ?? 0,
          cacheRead: providerFinish?.cacheReadTokens ?? 0,
          cacheWrite: 0,
          totalTokens: (providerFinish?.tokensIn ?? 0) + (providerFinish?.tokensOut ?? 0),
          cost: {
            input: providerFinish?.inputCostUsd ?? 0,
            output: providerFinish?.outputCostUsd ?? 0,
            cacheRead: 0,
            cacheWrite: 0,
            total: providerFinish?.costUsd ?? 0,
          },
        },
        stopReason: mapFinishReasonToStopReason(finishReason),
        timestamp: Date.now(),
      }
      piMessages.push(assistantMsg)
      for (const tr of turnToolResults) piMessages.push(tr)
    }

    const turnEnd: TurnEndEvent = {
      ...baseEventFields(scope),
      type: 'turn_end',
      tokensIn: llmEvt.tokensIn,
      tokensOut: assembledContent.length,
      costUsd: 0,
    }
    events.publish(turnEnd)

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
        budgetWarning.value = `⚠️ Approaching budget limit: ${budgetState.turnsConsumed} of ${opts.iterationBudget.maxTurnsPerWake} turns used. Please wrap up.`
      } else {
        budgetWarning.value = null
      }
    }

    // Roll bash history: snapshot turn N → visible to turn N+1's side-load.
    bashHistory.last = bashHistory.current
    bashHistory.current = []

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

  return endReason
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

// ----- shadow-history helpers ----------------------------------------------

function mapFinishReasonToStopReason(reason: string): Extract<AgentMessage, { role: 'assistant' }>['stopReason'] {
  switch (reason) {
    case 'tool_calls':
      return 'toolUse'
    case 'length':
      return 'length'
    case 'error':
      return 'error'
    default:
      return 'stop'
  }
}

function stringifyToolResult(result: unknown): string {
  if (result === undefined || result === null) return ''
  if (typeof result === 'string') return result
  try {
    return JSON.stringify(result)
  } catch {
    return String(result)
  }
}
