/**
 * Generic wake harness — `createHarness()` wraps `@mariozechner/pi-agent-core`'s
 * stateful `Agent` and translates its event stream into the `HarnessEvent` union.
 * Side-load is computed once per user-turn (same value surfaces in both
 * `capturedPrompts` and the LLM input); steer/abort are observed between turns.
 */

import {
  Agent,
  type AgentMessage,
  type AgentToolResult,
  type AgentEvent as PiAgentEvent,
  type AgentTool as PiAgentTool,
  type StreamFn,
} from '@mariozechner/pi-agent-core'
import type { AssistantMessage, Model } from '@mariozechner/pi-ai'
import { Type } from '@mariozechner/pi-ai'
import type { Bash, InMemoryFs } from 'just-bash'
import { nanoid } from 'nanoid'

import { createAgentsMdChainContributor, deriveTouchedDirsFromBashHistory } from './agents-md-chain'
import { makeBashTool } from './bash-tool'
import { createRestartRecoveryContributor, type GetLastWakeTail } from './restart-recovery'
import type { CustomSideLoadMaterializer } from './side-load-collector'
import { collectSideLoad, createBashHistoryMaterializer } from './side-load-collector'
import type { SteerQueueHandle } from './steer-queue'
import { TurnBudget } from './turn-budget'
import type {
  AbortContext,
  AgentTool,
  CommandDef,
  IterationBudget,
  SideLoadContributor,
  ToolResultPersistedEvent,
  WorkspaceMaterializer,
} from './types'
import { newWakeId } from './wake-id'

// ─── Generic event union ───────────────────────────────────────────────────

export interface HarnessBaseFields {
  ts: Date
  wakeId: string
  conversationId: string
  organizationId: string
  turnIndex: number
}

export type HarnessWakeTriggerKind = string

export type AgentStartEvent<TTrigger = unknown> = HarnessBaseFields & {
  type: 'agent_start'
  agentId: string
  trigger: HarnessWakeTriggerKind
  triggerPayload: TTrigger
  systemHash: string
}

export type AgentEndEvent = HarnessBaseFields & {
  type: 'agent_end'
  reason: 'complete' | 'blocked' | 'aborted' | 'error'
}

export type AgentAbortedEvent = HarnessBaseFields & {
  type: 'agent_aborted'
  reason: string
  abortedAt: 'pre_tool' | 'in_tool' | 'post_tool'
}

export type TurnStartEvent = HarnessBaseFields & { type: 'turn_start' }
export type TurnEndEvent = HarnessBaseFields & {
  type: 'turn_end'
  tokensIn: number
  tokensOut: number
  costUsd: number
}

export type MessageStartEvent = HarnessBaseFields & {
  type: 'message_start'
  messageId: string
  role: 'assistant' | 'tool' | 'user' | 'system'
}
export type MessageUpdateEvent = HarnessBaseFields & {
  type: 'message_update'
  messageId: string
  delta: string
}
export type MessageEndEvent = HarnessBaseFields & {
  type: 'message_end'
  messageId: string
  role: 'assistant' | 'tool' | 'user' | 'system'
  content: string
  reasoning?: string
  tokenCount?: number
  finishReason?: string
}

export type LlmCallEvent = HarnessBaseFields & {
  type: 'llm_call'
  task: string
  model: string
  provider: string
  tokensIn: number
  tokensOut: number
  cacheReadTokens: number
  costUsd: number
  latencyMs: number
  cacheHit: boolean
}

export type ToolExecutionStartEvent = HarnessBaseFields & {
  type: 'tool_execution_start'
  toolCallId: string
  toolName: string
  args: unknown
}
export type ToolExecutionEndEvent = HarnessBaseFields & {
  type: 'tool_execution_end'
  toolCallId: string
  toolName: string
  result: unknown
  isError: boolean
  latencyMs: number
}

export type SteerInjectedEvent = HarnessBaseFields & {
  type: 'steer_injected'
  text: string
}

export type HarnessEvent<TTrigger = unknown> =
  | AgentStartEvent<TTrigger>
  | AgentEndEvent
  | AgentAbortedEvent
  | TurnStartEvent
  | TurnEndEvent
  | MessageStartEvent
  | MessageUpdateEvent
  | MessageEndEvent
  | LlmCallEvent
  | ToolExecutionStartEvent
  | ToolExecutionEndEvent
  | SteerInjectedEvent
  | ToolResultPersistedEvent

// ─── Hooks ─────────────────────────────────────────────────────────────────

export interface OnToolCallCtx {
  toolCallId: string
  toolName: string
  args: unknown
  organizationId: string
  conversationId: string
  wakeId: string
  agentId: string
  turnIndex: number
}

export type OnToolCallListener = (
  ctx: OnToolCallCtx,
) => Promise<{ block?: boolean; reason?: string } | undefined> | { block?: boolean; reason?: string } | undefined

export interface OnToolResultCtx extends OnToolCallCtx {
  result: AgentToolResult<unknown>
  isError: boolean
}

export type OnToolResultListener = (
  ctx: OnToolResultCtx,
) =>
  | Promise<Partial<{ content: unknown; details: unknown; isError: boolean; terminate: string }> | undefined>
  | Partial<{ content: unknown; details: unknown; isError: boolean; terminate: string }>
  | undefined

export type OnEventListener<TTrigger = unknown> = (ev: HarnessEvent<TTrigger>) => Promise<void> | void

export interface HarnessHooks<TTrigger = unknown> {
  /** Composed into pi-agent `beforeToolCall` — first `{ block: true }` wins. */
  on_tool_call?: readonly OnToolCallListener[]
  /** Composed into pi-agent `afterToolCall` — field-merge in registration order. */
  on_tool_result?: readonly OnToolResultListener[]
  /** Fires once per published event. Errors swallowed per listener. */
  on_event?: readonly OnEventListener<TTrigger>[]
}

// ─── Inputs ────────────────────────────────────────────────────────────────

export interface HarnessAgentDefinition {
  model?: string
  instructions?: string
  workingMemory?: string
}

export interface HarnessWorkspace {
  bash: Bash
  innerFs: InMemoryFs
}

export interface HarnessLogger {
  debug(obj: unknown, msg?: string): void
  info(obj: unknown, msg?: string): void
  warn(obj: unknown, msg?: string): void
  error(obj: unknown, msg?: string): void
}

export interface WakeScope {
  organizationId: string
  conversationId: string
  wakeId: string
  turnIndex: number
}

export type StreamFnLike = StreamFn

export interface CreateHarnessOpts<TTrigger = unknown> {
  organizationId: string
  agentId: string
  contactId: string
  conversationId?: string

  agentDefinition: HarnessAgentDefinition
  // biome-ignore lint/suspicious/noExplicitAny: Model api type varies per provider; pi-ai narrows it at the call site
  model: Model<any>
  getApiKey?: () => string | undefined
  streamFn?: StreamFnLike

  /** Frozen system prompt + stable hash. Not recomputed mid-wake. */
  systemPrompt: string
  systemHash: string

  /** Opaque trigger payload + caller-provided renderer. */
  trigger?: TTrigger
  triggerKind?: HarnessWakeTriggerKind
  /** Render the trigger into the first user-turn message text. */
  renderTrigger: (trigger: TTrigger | undefined) => string
  /** Caller-classified approval decision extracted from trigger (used by tool ctx). */
  approvalDecision?: { decision: 'approved' | 'rejected'; note?: string; decidedByUserId?: string }

  workspace: HarnessWorkspace

  tools?: readonly AgentTool[]
  hooks?: HarnessHooks<TTrigger>
  materializers?: readonly WorkspaceMaterializer[]
  sideLoadContributors?: readonly SideLoadContributor[]
  commands?: readonly CommandDef[]

  journalAppend?: (ev: HarnessEvent<TTrigger>) => Promise<void>
  loadMessageHistory?: () => Promise<readonly AgentMessage[]>
  /** Called once per translated `turn_end` with the full pi AgentMessage tail. */
  onTurnEndSnapshot?: (messages: readonly AgentMessage[]) => Promise<void>
  getLastWakeTail?: GetLastWakeTail

  maxTurns?: number
  iterationBudget?: IterationBudget
  abortCtx?: AbortContext
  steerQueue?: SteerQueueHandle
  preWakeWrites?: readonly { path: string; content: string }[]
  logger?: HarnessLogger

  /** Extra custom side-load materializers beyond bash-history + restart-recovery. */
  extraCustomSideLoad?: readonly CustomSideLoadMaterializer[]

  /**
   * Opt into hierarchical `AGENTS.md` chain injection. When set, each turn the
   * harness parses the prior turn's bash history for touched directories,
   * walks ancestors for `AGENTS.md` files under the workspace fs, and injects
   * them as a `## Context hints` side-load block. Files de-dupe cumulatively
   * across the wake. `/agents/<agentId>/AGENTS.md` is skipped by default
   * because it is already in the frozen system prompt.
   */
  agentsMdChain?: {
    rootStop?: string
    filename?: string
    ignorePaths?: readonly string[]
    maxBytes?: number
  }

  /**
   * Optional handle exposing the harness's internal `publish` so out-of-band
   * code (e.g. a template-side `llmCall` helper) can surface synthesized
   * `llm_call` events back into the harness's event stream. Populated with a
   * closure that calls `publish(ev)` before the run starts; the same handle
   * is returned on the result so callers can keep using it across turns.
   */
  emitEventHandle?: { emit?: (ev: HarnessEvent<TTrigger>) => void }
}

// ─── Handle ────────────────────────────────────────────────────────────────

export interface CapturedPrompt {
  system: string
  systemHash: string
  firstUserMessage: string
}

export interface HarnessHandle<TTrigger = unknown> {
  capturedPrompts: CapturedPrompt[]
  events: readonly HarnessEvent<TTrigger>[]
  registerSideLoadMaterializer: (m: CustomSideLoadMaterializer) => void
  preWakeWrite: (path: string, content: string) => Promise<void>
}

export interface RunHarnessResult<TTrigger = unknown> {
  harness: HarnessHandle<TTrigger>
  conversationId: string
  wakeId: string
}

// ─── Helpers ───────────────────────────────────────────────────────────────

const noopLogger: HarnessLogger = {
  debug: () => undefined,
  info: () => undefined,
  warn: () => undefined,
  error: () => undefined,
}

function baseFields(scope: WakeScope): HarnessBaseFields {
  return {
    ts: new Date(),
    wakeId: scope.wakeId,
    conversationId: scope.conversationId,
    organizationId: scope.organizationId,
    turnIndex: scope.turnIndex,
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

class TurnTracker {
  turnIndex = -1
  sideLoadCache: string | null = null
  phase: 'pre_tool' | 'in_tool' | 'post_tool' = 'pre_tool'
  turnStartedAt = 0

  beginUserTurn(): void {
    this.turnIndex += 1
    this.sideLoadCache = null
    this.phase = 'pre_tool'
    this.turnStartedAt = Date.now()
  }

  onToolStart(): void {
    this.phase = 'in_tool'
  }
  onToolEnd(): void {
    this.phase = 'post_tool'
  }
}

interface TrackerRef {
  current: TurnTracker
  scope: WakeScope
  agentId: string
  approvalDecision?: { decision: 'approved' | 'rejected'; note?: string; decidedByUserId?: string }
}

function adaptToolForPi(tool: AgentTool, ref: TrackerRef): PiAgentTool {
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

// ─── Main entry ────────────────────────────────────────────────────────────

export async function createHarness<TTrigger = unknown>(
  opts: CreateHarnessOpts<TTrigger>,
): Promise<RunHarnessResult<TTrigger>> {
  const wakeId = newWakeId()
  const conversationId = opts.conversationId ?? nanoid(10)
  const logger = opts.logger ?? noopLogger

  const scope: WakeScope = {
    organizationId: opts.organizationId,
    conversationId,
    wakeId,
    turnIndex: 0,
  }

  const hooks: HarnessHooks<TTrigger> = opts.hooks ?? {}

  // Event fan-out: journal + on_event listeners + eventLog.
  const eventLog: HarnessEvent<TTrigger>[] = []
  let journalChain: Promise<void> = Promise.resolve()
  const publish = (ev: HarnessEvent<TTrigger>): void => {
    eventLog.push(ev)
    if (hooks.on_event) {
      for (const listener of hooks.on_event) {
        try {
          const r = listener(ev)
          if (r instanceof Promise)
            r.catch((err) => logger.error({ err, eventType: ev.type }, 'on_event listener failed'))
        } catch (err) {
          logger.error({ err, eventType: ev.type }, 'on_event listener failed')
        }
      }
    }
    if (opts.journalAppend) {
      journalChain = journalChain
        .then(() => opts.journalAppend?.(ev) ?? Promise.resolve())
        .catch((err) => {
          logger.error({ err, eventType: ev.type, wakeId, conversationId }, 'journal append failed')
        })
    }
  }
  if (opts.emitEventHandle) {
    opts.emitEventHandle.emit = publish
  }

  // Pre-load message history (optional).
  const piMessages: AgentMessage[] = []
  if (opts.loadMessageHistory) {
    try {
      const history = await opts.loadMessageHistory()
      for (const m of history) piMessages.push(m)
    } catch (err) {
      logger.warn({ err }, 'loadMessageHistory failed — continuing without history')
    }
  }

  // Pre-wake writes into workspace.
  for (const w of opts.preWakeWrites ?? []) {
    await opts.workspace.innerFs.writeFile(w.path, w.content)
  }

  // Bash tool wired to the workspace + turn budget.
  const turnBudget = new TurnBudget()
  const bashTool = makeBashTool({
    bash: opts.workspace.bash,
    innerWrite: async (path, content) => {
      await opts.workspace.innerFs.writeFile(path, content)
    },
    turnBudget,
    onSpill: (ev) => publish(ev as HarnessEvent<TTrigger>),
  })

  const toolIndex = new Map<string, AgentTool>()
  toolIndex.set('bash', bashTool as unknown as AgentTool)
  for (const t of opts.tools ?? []) toolIndex.set(t.name, t)

  const capturedPrompts: CapturedPrompt[] = []
  const customSideLoad: CustomSideLoadMaterializer[] = []
  const bashHistory: { last: string[]; current: string[] } = { last: [], current: [] }
  customSideLoad.push(createBashHistoryMaterializer(() => bashHistory.last))
  if (opts.getLastWakeTail) {
    customSideLoad.push(createRestartRecoveryContributor(conversationId, opts.getLastWakeTail))
  }
  if (opts.agentsMdChain) {
    const chainCfg = opts.agentsMdChain
    const defaultIgnore = [`/agents/${opts.agentId}/AGENTS.md`]
    customSideLoad.push(
      createAgentsMdChainContributor({
        fs: opts.workspace.innerFs,
        touchedDirsProvider: () => deriveTouchedDirsFromBashHistory(bashHistory.last),
        rootStop: chainCfg.rootStop,
        filename: chainCfg.filename,
        ignorePaths: chainCfg.ignorePaths ?? defaultIgnore,
        maxBytes: chainCfg.maxBytes,
      }),
    )
  }
  for (const m of opts.extraCustomSideLoad ?? []) customSideLoad.push(m)

  // agent_start ─────────────────────────────────────────────────────────────
  const triggerKind = opts.triggerKind ?? 'manual'
  const startEvt: AgentStartEvent<TTrigger> = {
    ...baseFields(scope),
    type: 'agent_start',
    agentId: opts.agentId,
    trigger: triggerKind,
    triggerPayload: opts.trigger as TTrigger,
    systemHash: opts.systemHash,
  }
  publish(startEvt)

  // Tracker + translation layer ─────────────────────────────────────────────
  const tracker = new TurnTracker()
  const trackerRef: TrackerRef = {
    current: tracker,
    scope,
    agentId: opts.agentId,
    approvalDecision: opts.approvalDecision,
  }

  const piTools: PiAgentTool[] = []
  for (const t of toolIndex.values()) piTools.push(adaptToolForPi(t, trackerRef))

  const modelId = opts.model.id
  const providerName = opts.model.provider

  let currentMessageId: string | null = null
  let assembledContent = ''
  let firstSubTurnOfUserTurn = true
  let turnTokensIn = 0
  let turnTokensOut = 0
  let turnCostUsd = 0

  const agentOpts: ConstructorParameters<typeof Agent>[0] = {
    initialState: {
      systemPrompt: opts.systemPrompt,
      model: opts.model,
      tools: piTools,
      thinkingLevel: 'off',
      messages: piMessages.length > 0 ? ([...piMessages] as AgentMessage[]) : undefined,
    },
    convertToLlm: (msgs: AgentMessage[]) => msgs as never,
    transformContext: async (msgs: AgentMessage[]) => {
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
    getApiKey: () => opts.getApiKey?.(),
    beforeToolCall: async (ctx) => {
      const onCallCtx: OnToolCallCtx = {
        toolCallId: ctx.toolCall.id,
        toolName: ctx.toolCall.name,
        args: ctx.args,
        organizationId: opts.organizationId,
        conversationId,
        wakeId,
        agentId: opts.agentId,
        turnIndex: Math.max(0, tracker.turnIndex),
      }
      for (const listener of hooks.on_tool_call ?? []) {
        try {
          const r = await listener(onCallCtx)
          if (r?.block) return { block: true, reason: r.reason }
        } catch (err) {
          logger.error({ err }, 'on_tool_call listener failed')
        }
      }
      return undefined
    },
    afterToolCall: async (ctx) => {
      const onResultCtx: OnToolResultCtx = {
        toolCallId: ctx.toolCall.id,
        toolName: ctx.toolCall.name,
        args: ctx.args,
        result: ctx.result,
        isError: Boolean(ctx.isError),
        organizationId: opts.organizationId,
        conversationId,
        wakeId,
        agentId: opts.agentId,
        turnIndex: Math.max(0, tracker.turnIndex),
      }
      let merged: Partial<{ content: unknown; details: unknown; isError: boolean; terminate: string }> | undefined
      for (const listener of hooks.on_tool_result ?? []) {
        try {
          const r = await listener(onResultCtx)
          if (r) merged = { ...(merged ?? {}), ...r }
        } catch (err) {
          logger.error({ err }, 'on_tool_result listener failed')
        }
      }
      return merged as never
    },
  }
  if (opts.streamFn) {
    ;(agentOpts as { streamFn?: unknown }).streamFn = opts.streamFn
  }

  const agent = new Agent(agentOpts)

  // Pi event → contract translation ─────────────────────────────────────────
  agent.subscribe((piEv: PiAgentEvent) => {
    const curScope: WakeScope = { ...scope, turnIndex: Math.max(0, tracker.turnIndex) }
    switch (piEv.type) {
      case 'turn_start': {
        if (firstSubTurnOfUserTurn) {
          firstSubTurnOfUserTurn = false
          publish({ ...baseFields(curScope), type: 'turn_start' })
          turnBudget.reset()
        }
        break
      }
      case 'message_start': {
        if (piEv.message.role !== 'assistant') break
        currentMessageId = nanoid(10)
        assembledContent = ''
        publish({
          ...baseFields(curScope),
          type: 'message_start',
          messageId: currentMessageId,
          role: 'assistant',
        })
        break
      }
      case 'message_update': {
        if (!currentMessageId) break
        if (piEv.message.role !== 'assistant') break
        const pev = piEv.assistantMessageEvent
        if (pev.type === 'text_delta') {
          assembledContent += pev.delta
          publish({
            ...baseFields(curScope),
            type: 'message_update',
            messageId: currentMessageId,
            delta: pev.delta,
          })
        }
        break
      }
      case 'message_end': {
        if (!currentMessageId) break
        if (piEv.message.role !== 'assistant') break
        const assistant = piEv.message as AssistantMessage
        const finishReason = typeof assistant.stopReason === 'string' ? assistant.stopReason : 'stop'
        const usage = assistant.usage
        const callTokensIn = usage?.input ?? 0
        const callTokensOut = usage?.output ?? 0
        const callCost = usage?.cost?.total ?? 0
        turnTokensIn += callTokensIn
        turnTokensOut += callTokensOut
        turnCostUsd += callCost
        publish({
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
        })
        const textContent = assembledContent || extractAssistantText(assistant)
        publish({
          ...baseFields(curScope),
          type: 'message_end',
          messageId: currentMessageId,
          role: 'assistant',
          content: textContent,
          finishReason,
          tokenCount: textContent.length,
        })
        break
      }
      case 'tool_execution_start': {
        tracker.onToolStart()
        if (piEv.toolName === 'bash') {
          const cmd = (piEv.args as { command?: string } | null | undefined)?.command
          if (typeof cmd === 'string' && cmd.length > 0) bashHistory.current.push(cmd)
        }
        publish({
          ...baseFields(curScope),
          type: 'tool_execution_start',
          toolCallId: piEv.toolCallId,
          toolName: piEv.toolName,
          args: piEv.args,
        })
        break
      }
      case 'tool_execution_end': {
        tracker.onToolEnd()
        const pr = piEv.result as AgentToolResult<unknown> | undefined
        const detailsValue = pr?.details
        const detailsPresent =
          detailsValue !== undefined &&
          !(typeof detailsValue === 'object' && detailsValue !== null && Object.keys(detailsValue).length === 0)
        let ourResult: unknown = detailsPresent ? detailsValue : pr
        if (piEv.isError) {
          const text = pr?.content?.find((c): c is { type: 'text'; text: string } => c.type === 'text')?.text
          if (text) ourResult = { ok: false, error: text }
        }
        publish({
          ...baseFields(curScope),
          type: 'tool_execution_end',
          toolCallId: piEv.toolCallId,
          toolName: piEv.toolName,
          result: ourResult,
          isError: Boolean(piEv.isError),
          latencyMs: 0,
        })
        break
      }
      default:
        break
    }
  })

  // User-turn loop ─────────────────────────────────────────────────────────
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

  for (let t = 0; t < maxTurns; t += 1) {
    if (t > 0 && pendingSteerText === null) break
    tracker.beginUserTurn()
    firstSubTurnOfUserTurn = true
    turnTokensIn = 0
    turnTokensOut = 0
    turnCostUsd = 0
    const curScope: WakeScope = { ...scope, turnIndex: tracker.turnIndex }

    let userText = opts.renderTrigger(opts.trigger)
    if (pendingSteerText !== null) {
      publish({ ...baseFields(curScope), type: 'steer_injected', text: pendingSteerText })
      userText = `${pendingSteerText}\n\n${userText}`
      pendingSteerText = null
    }

    const sideLoadBody = await collectSideLoad({
      ctx: {
        organizationId: opts.organizationId,
        conversationId,
        agentId: opts.agentId,
        contactId: opts.contactId,
        turnIndex: tracker.turnIndex,
      },
      contributors: opts.sideLoadContributors ?? [],
      customMaterializers: customSideLoad,
      bash: opts.workspace.bash,
    })
    tracker.sideLoadCache = sideLoadBody
    const firstUserMessage = sideLoadBody ? `${sideLoadBody}\n\n${userText}` : userText
    capturedPrompts.push({
      system: opts.systemPrompt,
      systemHash: opts.systemHash,
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

    publish({
      ...baseFields(curScope),
      type: 'turn_end',
      tokensIn: turnTokensIn,
      tokensOut: turnTokensOut,
      costUsd: turnCostUsd,
    })

    if (opts.onTurnEndSnapshot) {
      try {
        await opts.onTurnEndSnapshot(agent.state.messages as readonly AgentMessage[])
      } catch (err) {
        logger.error({ err }, 'onTurnEndSnapshot failed')
      }
    }

    bashHistory.last = bashHistory.current
    bashHistory.current = []

    if (abortSignal?.aborted || agent.state.errorMessage) {
      publish({
        ...baseFields(curScope),
        type: 'agent_aborted',
        reason: opts.abortCtx?.reason ?? agent.state.errorMessage ?? 'external',
        abortedAt: tracker.phase,
      })
      endReason = 'aborted'
      break
    }

    if (opts.steerQueue) {
      const steers = opts.steerQueue.drain()
      if (steers.length > 0) pendingSteerText = steers.join('\n\n')
    }
  }

  publish({
    ...baseFields({ ...scope, turnIndex: Math.max(0, tracker.turnIndex) }),
    type: 'agent_end',
    reason: endReason,
  })

  await journalChain

  const handle: HarnessHandle<TTrigger> = {
    capturedPrompts,
    events: eventLog,
    registerSideLoadMaterializer: (m) => {
      customSideLoad.push(m)
    },
    preWakeWrite: async (path, content) => {
      await opts.workspace.innerFs.writeFile(path, content)
    },
  }

  return { harness: handle, conversationId, wakeId }
}
