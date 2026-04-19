/**
 * OpenAI provider — `LlmProvider` implementation for `/v1/chat/completions` streaming.
 *
 * Translates OpenAI SSE stream events into our `LlmStreamChunk` contract:
 *
 *   choices[0].delta.content          -> LlmTextDelta
 *   choices[0].delta.tool_calls[i].id / function.name (first frame) -> LlmToolUseStart
 *   choices[0].delta.tool_calls[i].function.arguments (delta)       -> LlmToolUseDelta
 *   choices[0].finish_reason set (last frame before [DONE])          -> LlmToolUseEnd for each open block, then LlmFinish
 *
 * Cost accounting: tokensIn/tokensOut from the final chunk's `usage` (requires
 * `stream_options: { include_usage: true }`). OpenAI does not surface cache
 * read/write tokens — we default `cacheReadTokens: 0`.
 *
 * Used by the nightly live-API test path. Mirrors `anthropic.ts` in structure
 * so the harness can swap providers without behavioural drift.
 */

import { createHash } from 'node:crypto'
import type { LlmRequest } from '@server/contracts/plugin-context'
import type { LlmFinish, LlmProvider, LlmStreamChunk } from '@server/contracts/provider-port'

export type OpenAIFetch = (url: string, init: RequestInit) => Promise<Response>

export interface OpenAIProviderConfig {
  /** OPENAI_API_KEY — required. */
  apiKey: string
  /** Default model id when `LlmRequest.model` is not set (e.g. 'gpt-5.4'). */
  defaultModel: string
  /** Output token ceiling. Defaults to 4096. */
  maxTokens?: number
  /** Override for tests; defaults to https://api.openai.com. */
  baseUrl?: string
  /** Injectable fetch for tests; defaults to globalThis.fetch. */
  fetch?: OpenAIFetch
  /** Organization header. Optional. */
  organization?: string
  /** Cost per 1M input tokens (USD). */
  inputPricePerMTok?: number
  /** Cost per 1M output tokens (USD). */
  outputPricePerMTok?: number
}

interface OpenAIUsage {
  prompt_tokens?: number
  completion_tokens?: number
  total_tokens?: number
  prompt_tokens_details?: { cached_tokens?: number }
}

export function createOpenAIProvider(cfg: OpenAIProviderConfig): LlmProvider {
  const fetchImpl = cfg.fetch ?? (globalThis.fetch as OpenAIFetch)
  const baseUrl = cfg.baseUrl ?? 'https://api.openai.com'
  const maxTokens = cfg.maxTokens ?? 4096
  const inputPrice = cfg.inputPricePerMTok ?? 2.5
  const outputPrice = cfg.outputPricePerMTok ?? 10

  // Single-slot cache: the system prompt is the frozen wake snapshot, so the
  // cache_key derived from it is identical across every LLM call within a wake.
  const cacheKeyMemo = { system: '' as string | null, key: '' }
  const cacheKeyFor = (system: string): string => {
    if (cacheKeyMemo.system === system) return cacheKeyMemo.key
    cacheKeyMemo.system = system
    cacheKeyMemo.key = createHash('sha256').update(system).digest('hex').slice(0, 16)
    return cacheKeyMemo.key
  }

  return {
    name: 'openai',
    stream(request: LlmRequest): AsyncIterableIterator<LlmStreamChunk> {
      return runStream({
        apiKey: cfg.apiKey,
        organization: cfg.organization,
        model: request.model ?? cfg.defaultModel,
        request,
        fetch: fetchImpl,
        baseUrl,
        maxTokens,
        inputPrice,
        outputPrice,
        cacheKeyFor,
      })
    },
  }
}

interface StreamArgs {
  apiKey: string
  organization?: string
  model: string
  request: LlmRequest
  fetch: OpenAIFetch
  baseUrl: string
  maxTokens: number
  inputPrice: number
  outputPrice: number
  cacheKeyFor?: (system: string) => string
}

export function buildOpenAIRequestBody(args: StreamArgs): Record<string, unknown> {
  const messages: Array<Record<string, unknown>> = []
  if (args.request.system) {
    messages.push({ role: 'system', content: args.request.system })
  }
  for (const m of args.request.messages ?? []) {
    messages.push({ role: m.role, content: m.content })
  }

  const tools = args.request.tools?.map((t) => ({
    type: 'function' as const,
    function: {
      name: t.name,
      description: t.description,
      parameters: (t.inputSchema ?? { type: 'object', properties: {} }) as object,
    },
  }))

  const body: Record<string, unknown> = {
    model: args.model,
    max_completion_tokens: args.maxTokens,
    stream: true,
    stream_options: { include_usage: true },
    messages,
  }
  if (tools && tools.length > 0) body.tools = tools
  // extra_body is forwarded by Bifrost; the upstream provider sees it as native.
  if (args.request.system) {
    const sys = args.request.system
    const promptCacheKey = args.cacheKeyFor
      ? args.cacheKeyFor(sys)
      : createHash('sha256').update(sys).digest('hex').slice(0, 16)
    body.extra_body = {
      prompt_cache_key: promptCacheKey,
      prompt_cache_retention: '24h',
    }
  }
  return body
}

async function* runStream(args: StreamArgs): AsyncIterableIterator<LlmStreamChunk> {
  const startedAt = Date.now()
  const body = buildOpenAIRequestBody(args)

  let response: Response
  try {
    const headers: Record<string, string> = {
      Authorization: `Bearer ${args.apiKey}`,
      'content-type': 'application/json',
      accept: 'text/event-stream',
    }
    if (args.organization) headers['OpenAI-Organization'] = args.organization

    response = await args.fetch(`${args.baseUrl}/v1/chat/completions`, {
      method: 'POST',
      headers,
      body: JSON.stringify(body),
    })
  } catch (err) {
    yield errorFinish(Date.now() - startedAt)
    void err
    return
  }

  if (!response.ok || !response.body) {
    try {
      await response.text()
    } catch {
      // ignore
    }
    yield errorFinish(Date.now() - startedAt)
    return
  }

  const reader = response.body.getReader()
  const decoder = new TextDecoder()
  let buffer = ''
  // OpenAI streams tool_calls by index; we map index -> (toolCallId, toolName, started).
  const toolBlocks = new Map<number, { toolCallId: string; toolName: string; started: boolean }>()
  let usage: OpenAIUsage = {}
  let finishReason: LlmFinish['finishReason'] = 'end_turn'

  try {
    while (true) {
      const { value, done } = await reader.read()
      if (done) break
      buffer += decoder.decode(value, { stream: true })
      while (true) {
        const nlIdx = buffer.indexOf('\n')
        if (nlIdx < 0) break
        const rawLine = buffer.slice(0, nlIdx)
        buffer = buffer.slice(nlIdx + 1)
        const line = rawLine.replace(/\r$/, '')
        if (!line.startsWith('data:')) continue
        const dataStr = line.slice(5).trim()
        if (!dataStr || dataStr === '[DONE]') continue
        let parsed: unknown
        try {
          parsed = JSON.parse(dataStr)
        } catch {
          continue
        }
        const chunks = translateOpenAIEvent(
          parsed,
          toolBlocks,
          (u) => {
            usage = { ...usage, ...u }
          },
          (r) => {
            finishReason = r
          },
        )
        for (const c of chunks) yield c
      }
    }
  } finally {
    try {
      reader.releaseLock()
    } catch {
      // ignore
    }
  }

  // Close any still-open tool blocks (defensive — OpenAI signals finish via finish_reason in-band).
  for (const [, block] of toolBlocks) {
    if (block.started) yield { type: 'tool-use-end', toolCallId: block.toolCallId }
  }

  const tokensIn = usage.prompt_tokens ?? 0
  const tokensOut = usage.completion_tokens ?? 0
  const cacheReadTokens = usage.prompt_tokens_details?.cached_tokens ?? 0
  const inputCostUsd = (tokensIn * args.inputPrice) / 1_000_000
  const outputCostUsd = (tokensOut * args.outputPrice) / 1_000_000

  yield {
    type: 'finish',
    finishReason,
    tokensIn,
    tokensOut,
    cacheReadTokens,
    costUsd: inputCostUsd + outputCostUsd,
    inputCostUsd,
    outputCostUsd,
    latencyMs: Date.now() - startedAt,
    cacheHit: cacheReadTokens > 0,
  }
}

export function translateOpenAIEvent(
  event: unknown,
  toolBlocks: Map<number, { toolCallId: string; toolName: string; started: boolean }>,
  onUsage: (u: OpenAIUsage) => void,
  onFinishReason: (r: LlmFinish['finishReason']) => void,
): LlmStreamChunk[] {
  if (!event || typeof event !== 'object') return []
  const ev = event as Record<string, unknown>

  const usage = ev.usage as OpenAIUsage | undefined
  if (usage) onUsage(usage)

  const choices = ev.choices as Array<Record<string, unknown>> | undefined
  if (!choices || choices.length === 0) return []
  const choice = choices[0]
  const out: LlmStreamChunk[] = []

  const delta = choice?.delta as Record<string, unknown> | undefined
  if (delta) {
    const text = delta.content
    if (typeof text === 'string' && text.length > 0) {
      out.push({ type: 'text-delta', text })
    }
    const toolCalls = delta.tool_calls as Array<Record<string, unknown>> | undefined
    if (toolCalls) {
      for (const tc of toolCalls) {
        const idx = typeof tc.index === 'number' ? tc.index : 0
        let block = toolBlocks.get(idx)
        const fn = tc.function as Record<string, unknown> | undefined
        const id = typeof tc.id === 'string' ? tc.id : undefined
        const name = typeof fn?.name === 'string' ? fn.name : undefined

        if (!block) {
          block = { toolCallId: id ?? '', toolName: name ?? '', started: false }
          toolBlocks.set(idx, block)
        } else {
          if (id && !block.toolCallId) block.toolCallId = id
          if (name && !block.toolName) block.toolName = name
        }

        // Emit start once we have both id and name.
        if (!block.started && block.toolCallId && block.toolName) {
          block.started = true
          out.push({ type: 'tool-use-start', toolCallId: block.toolCallId, toolName: block.toolName })
        }

        const argDelta = typeof fn?.arguments === 'string' ? fn.arguments : ''
        if (argDelta && block.started) {
          out.push({ type: 'tool-use-delta', toolCallId: block.toolCallId, inputJsonDelta: argDelta })
        }
      }
    }
  }

  const finishReasonRaw = choice?.finish_reason
  if (typeof finishReasonRaw === 'string' && finishReasonRaw.length > 0) {
    // Close any open tool blocks for this choice.
    for (const [idx, block] of toolBlocks) {
      if (block.started) {
        out.push({ type: 'tool-use-end', toolCallId: block.toolCallId })
      }
      toolBlocks.delete(idx)
    }
    onFinishReason(mapFinishReason(finishReasonRaw))
  }

  return out
}

function mapFinishReason(reason: string): LlmFinish['finishReason'] {
  switch (reason) {
    case 'stop':
      return 'end_turn'
    case 'tool_calls':
      return 'tool_use'
    case 'length':
      return 'max_tokens'
    case 'content_filter':
      return 'stop_sequence'
    default:
      return reason
  }
}

function errorFinish(latencyMs: number): LlmFinish {
  return {
    type: 'finish',
    finishReason: 'error',
    tokensIn: 0,
    tokensOut: 0,
    cacheReadTokens: 0,
    costUsd: 0,
    latencyMs,
    cacheHit: false,
  }
}
