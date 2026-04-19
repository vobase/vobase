/**
 * Gemini provider — `LlmProvider` implementation for
 * `v1beta/models/{model}:streamGenerateContent` (SSE, `?alt=sse`).
 *
 * Uses fetch() directly against Google's Generative Language API — no SDK —
 * so tests can stub the transport via the injectable `fetch` option.
 * Pattern mirrors `anthropic.ts` and `openai.ts`.
 *
 * Event translation:
 *   candidates[0].content.parts[i].text              -> LlmTextDelta (streamed)
 *   candidates[0].content.parts[i].functionCall      -> LlmToolUseStart + Delta + End
 *   candidates[0].finishReason set                   -> triggers LlmFinish
 *   usageMetadata.promptTokenCount / candidatesTokenCount -> cost accounting
 *
 * Gemini does not surface cache tokens; `cacheReadTokens` is always 0.
 */

import type { LlmRequest } from '@server/contracts/plugin-context'
import type { LlmFinish, LlmProvider, LlmStreamChunk } from '@server/contracts/provider-port'
import { type GeminiUsage, translateGeminiEvent } from './translate-gemini-event'

export type GeminiFetch = (url: string, init: RequestInit) => Promise<Response>

export interface GeminiProviderConfig {
  /** GOOGLE_API_KEY — required. */
  apiKey: string
  /** Default model id when `LlmRequest.model` is not set (e.g. 'gemini-2.0-flash'). */
  defaultModel: string
  /** Output token ceiling. Defaults to 4096. */
  maxTokens?: number
  /** Override for tests; defaults to https://generativelanguage.googleapis.com. */
  baseUrl?: string
  /** Injectable fetch for tests; defaults to globalThis.fetch. */
  fetch?: GeminiFetch
  /** Cost per 1M input tokens (USD). Defaults to gemini-2.0-flash pricing. */
  inputPricePerMTok?: number
  /** Cost per 1M output tokens (USD). */
  outputPricePerMTok?: number
}

export function createGeminiProvider(cfg: GeminiProviderConfig): LlmProvider {
  const fetchImpl = cfg.fetch ?? (globalThis.fetch as GeminiFetch)
  const baseUrl = cfg.baseUrl ?? 'https://generativelanguage.googleapis.com'
  const maxTokens = cfg.maxTokens ?? 4096
  const inputPrice = cfg.inputPricePerMTok ?? 0.075
  const outputPrice = cfg.outputPricePerMTok ?? 0.3

  return {
    name: 'gemini',
    stream(request: LlmRequest): AsyncIterableIterator<LlmStreamChunk> {
      return runStream({
        apiKey: cfg.apiKey,
        model: request.model ?? cfg.defaultModel,
        request,
        fetch: fetchImpl,
        baseUrl,
        maxTokens,
        inputPrice,
        outputPrice,
      })
    },
  }
}

interface StreamArgs {
  apiKey: string
  model: string
  request: LlmRequest
  fetch: GeminiFetch
  baseUrl: string
  maxTokens: number
  inputPrice: number
  outputPrice: number
}

export function buildGeminiRequestBody(args: StreamArgs): Record<string, unknown> {
  const contents = (args.request.messages ?? []).map((m) => ({
    role: m.role === 'assistant' ? 'model' : 'user',
    parts: [{ text: m.content }],
  }))

  const tools = args.request.tools?.map((t) => ({
    name: t.name,
    description: t.description,
    parameters: (t.inputSchema ?? { type: 'object', properties: {} }) as object,
  }))

  const body: Record<string, unknown> = {
    contents,
    generationConfig: { maxOutputTokens: args.maxTokens },
  }
  if (args.request.system) {
    body.systemInstruction = { parts: [{ text: args.request.system }] }
  }
  if (tools && tools.length > 0) {
    body.tools = [{ functionDeclarations: tools }]
  }
  return body
}

async function* runStream(args: StreamArgs): AsyncIterableIterator<LlmStreamChunk> {
  const startedAt = Date.now()
  const body = buildGeminiRequestBody(args)

  let response: Response
  try {
    response = await args.fetch(
      `${args.baseUrl}/v1beta/models/${args.model}:streamGenerateContent?alt=sse&key=${args.apiKey}`,
      {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify(body),
      },
    )
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
  let usage: GeminiUsage = {}
  let finishReason: LlmFinish['finishReason'] = 'end_turn'
  const state = { toolCallCounter: 0 }

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
        const chunks = translateGeminiEvent(
          parsed,
          state,
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

  const tokensIn = usage.promptTokenCount ?? 0
  const tokensOut = usage.candidatesTokenCount ?? 0
  const costUsd = (tokensIn * args.inputPrice) / 1_000_000 + (tokensOut * args.outputPrice) / 1_000_000

  yield {
    type: 'finish',
    finishReason,
    tokensIn,
    tokensOut,
    cacheReadTokens: 0,
    costUsd,
    latencyMs: Date.now() - startedAt,
    cacheHit: false,
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
