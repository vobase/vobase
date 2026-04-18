/**
 * Anthropic provider — `LlmProvider` implementation for `/v1/messages` streaming.
 * Plan §P2.1 (critical path).
 *
 * Uses fetch() directly against Anthropic's HTTP API so tests can stub the
 * transport via the injectable `fetch` option. The streaming parser translates
 * the Anthropic SSE event union into our `LlmStreamChunk` contract:
 *
 *   content_block_start (text)    -> (no chunk; deltas follow)
 *   content_block_start (tool_use) -> LlmToolUseStart
 *   content_block_delta (text_delta) -> LlmTextDelta
 *   content_block_delta (input_json_delta) -> LlmToolUseDelta
 *   content_block_stop (tool block) -> LlmToolUseEnd
 *   message_stop / message_delta.stop_reason -> LlmFinish
 *
 * Cost accounting: tokensIn/tokensOut from `usage`; costUsd derived from
 * per-million-token prices (defaults match public Claude Sonnet 4.6 pricing).
 */

import type { LlmRequest } from '@server/contracts/plugin-context'
import type { LlmFinish, LlmProvider, LlmStreamChunk } from '@server/contracts/provider-port'

export type AnthropicFetch = (url: string, init: RequestInit) => Promise<Response>

export interface AnthropicProviderConfig {
  /** ANTHROPIC_API_KEY — required. */
  apiKey: string
  /** Default model id when `LlmRequest.model` is not set (e.g. 'claude-sonnet-4-6'). */
  defaultModel: string
  /** Output token ceiling. Defaults to 4096. */
  maxTokens?: number
  /** Override for tests; defaults to https://api.anthropic.com. */
  baseUrl?: string
  /** Injectable fetch for tests; defaults to globalThis.fetch. */
  fetch?: AnthropicFetch
  /** anthropic-version header. Defaults to '2023-06-01'. */
  anthropicVersion?: string
  /** Cost per 1M input tokens (USD). */
  inputPricePerMTok?: number
  /** Cost per 1M output tokens (USD). */
  outputPricePerMTok?: number
  /** Cost per 1M cache-read tokens (USD). */
  cacheReadPricePerMTok?: number
  /** Cost per 1M cache-write tokens (USD). */
  cacheWritePricePerMTok?: number
}

interface AnthropicUsage {
  input_tokens?: number
  output_tokens?: number
  cache_creation_input_tokens?: number
  cache_read_input_tokens?: number
}

export function createAnthropicProvider(cfg: AnthropicProviderConfig): LlmProvider {
  const fetchImpl = cfg.fetch ?? (globalThis.fetch as AnthropicFetch)
  const baseUrl = cfg.baseUrl ?? 'https://api.anthropic.com'
  const maxTokens = cfg.maxTokens ?? 4096
  const anthropicVersion = cfg.anthropicVersion ?? '2023-06-01'
  const inputPrice = cfg.inputPricePerMTok ?? 3
  const outputPrice = cfg.outputPricePerMTok ?? 15
  const cacheReadPrice = cfg.cacheReadPricePerMTok ?? 0.3
  const cacheWritePrice = cfg.cacheWritePricePerMTok ?? 3.75

  return {
    name: 'anthropic',
    stream(request: LlmRequest): AsyncIterableIterator<LlmStreamChunk> {
      return runStream({
        apiKey: cfg.apiKey,
        model: request.model ?? cfg.defaultModel,
        request,
        fetch: fetchImpl,
        baseUrl,
        maxTokens,
        anthropicVersion,
        inputPrice,
        outputPrice,
        cacheReadPrice,
        cacheWritePrice,
      })
    },
  }
}

interface StreamArgs {
  apiKey: string
  model: string
  request: LlmRequest
  fetch: AnthropicFetch
  baseUrl: string
  maxTokens: number
  anthropicVersion: string
  inputPrice: number
  outputPrice: number
  cacheReadPrice: number
  cacheWritePrice: number
}

export function buildAnthropicRequestBody(args: StreamArgs): Record<string, unknown> {
  const messages = (args.request.messages ?? []).map((m) => ({
    role: m.role === 'assistant' ? 'assistant' : 'user',
    content: m.content,
  }))
  const tools = args.request.tools?.map((t) => ({
    name: t.name,
    description: t.description,
    input_schema: (t.inputSchema ?? { type: 'object', properties: {} }) as object,
  }))
  const body: Record<string, unknown> = {
    model: args.model,
    max_tokens: args.maxTokens,
    stream: true,
    messages,
  }
  if (args.request.system) body.system = args.request.system
  if (tools && tools.length > 0) body.tools = tools
  return body
}

async function* runStream(args: StreamArgs): AsyncIterableIterator<LlmStreamChunk> {
  const startedAt = Date.now()
  const body = buildAnthropicRequestBody(args)

  let response: Response
  try {
    response = await args.fetch(`${args.baseUrl}/v1/messages`, {
      method: 'POST',
      headers: {
        'x-api-key': args.apiKey,
        'anthropic-version': args.anthropicVersion,
        'content-type': 'application/json',
        accept: 'text/event-stream',
      },
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
  const toolBlocks = new Map<number, { toolCallId: string; toolName: string }>()
  let usage: AnthropicUsage = {}
  let finishReason: LlmFinish['finishReason'] = 'end_turn'

  try {
    while (true) {
      const { value, done } = await reader.read()
      if (done) break
      buffer += decoder.decode(value, { stream: true })
      // SSE: blocks separated by blank lines; lines start with "event:" or "data:".
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
        const chunks = translateAnthropicEvent(
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

  const tokensIn = usage.input_tokens ?? 0
  const tokensOut = usage.output_tokens ?? 0
  const cacheReadTokens = usage.cache_read_input_tokens ?? 0
  const cacheWriteTokens = usage.cache_creation_input_tokens ?? 0
  const costUsd =
    (tokensIn * args.inputPrice) / 1_000_000 +
    (tokensOut * args.outputPrice) / 1_000_000 +
    (cacheReadTokens * args.cacheReadPrice) / 1_000_000 +
    (cacheWriteTokens * args.cacheWritePrice) / 1_000_000

  yield {
    type: 'finish',
    finishReason,
    tokensIn,
    tokensOut,
    cacheReadTokens,
    costUsd,
    latencyMs: Date.now() - startedAt,
    cacheHit: cacheReadTokens > 0,
  }
}

export function translateAnthropicEvent(
  event: unknown,
  toolBlocks: Map<number, { toolCallId: string; toolName: string }>,
  onUsage: (u: AnthropicUsage) => void,
  onStopReason: (r: LlmFinish['finishReason']) => void,
): LlmStreamChunk[] {
  if (!event || typeof event !== 'object') return []
  const ev = event as Record<string, unknown>
  const evType = ev.type

  if (evType === 'message_start') {
    const message = ev.message as { usage?: AnthropicUsage } | undefined
    if (message?.usage) onUsage(message.usage)
    return []
  }

  if (evType === 'content_block_start') {
    const idx = typeof ev.index === 'number' ? ev.index : -1
    const block = ev.content_block as Record<string, unknown> | undefined
    if (block?.type === 'tool_use' && idx >= 0) {
      const toolCallId = String(block.id ?? '')
      const toolName = String(block.name ?? '')
      toolBlocks.set(idx, { toolCallId, toolName })
      return [{ type: 'tool-use-start', toolCallId, toolName }]
    }
    return []
  }

  if (evType === 'content_block_delta') {
    const idx = typeof ev.index === 'number' ? ev.index : -1
    const delta = ev.delta as Record<string, unknown> | undefined
    if (!delta) return []
    if (delta.type === 'text_delta') {
      return [{ type: 'text-delta', text: String(delta.text ?? '') }]
    }
    if (delta.type === 'input_json_delta') {
      const block = toolBlocks.get(idx)
      if (!block) return []
      return [
        {
          type: 'tool-use-delta',
          toolCallId: block.toolCallId,
          inputJsonDelta: String(delta.partial_json ?? ''),
        },
      ]
    }
    return []
  }

  if (evType === 'content_block_stop') {
    const idx = typeof ev.index === 'number' ? ev.index : -1
    const block = toolBlocks.get(idx)
    if (block) {
      toolBlocks.delete(idx)
      return [{ type: 'tool-use-end', toolCallId: block.toolCallId }]
    }
    return []
  }

  if (evType === 'message_delta') {
    const delta = ev.delta as Record<string, unknown> | undefined
    const usage = ev.usage as AnthropicUsage | undefined
    if (usage) onUsage(usage)
    if (delta?.stop_reason) onStopReason(mapStopReason(String(delta.stop_reason)))
    return []
  }

  if (evType === 'message_stop') {
    return []
  }

  if (evType === 'error') {
    onStopReason('error')
    return []
  }

  return []
}

function mapStopReason(reason: string): LlmFinish['finishReason'] {
  switch (reason) {
    case 'end_turn':
      return 'end_turn'
    case 'tool_use':
      return 'tool_use'
    case 'max_tokens':
      return 'max_tokens'
    case 'stop_sequence':
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
