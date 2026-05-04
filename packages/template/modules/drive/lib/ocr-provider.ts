/**
 * OCR provider: multimodal caption + transcription via the AI SDK v6.
 *
 * Routing — pick the first that has credentials:
 *   1. Bifrost (`BIFROST_API_KEY` + `BIFROST_URL`) — the gateway speaks the
 *      OpenAI Responses API, so we use `@ai-sdk/openai` with `baseURL`
 *      pointed at the gateway and route to `google/gemini-2.0-flash`.
 *   2. Direct OpenAI (`OPENAI_API_KEY`) — `models.gpt_mini` (cheap
 *      multimodal). Bare model id is the `openai/`-stripped value.
 *   3. Otherwise throw — caller (`extract.ts`) reports the failure verbatim
 *      via `processingError`, so the UI tooltip surfaces "OCR requires …".
 *
 * We call `provider.chat(...)` explicitly (Chat Completions) rather than the
 * default callable (Responses API) so Bifrost — which only speaks Chat
 * Completions — and direct OpenAI both go through the same code path.
 */

import { models, splitModelId } from '@modules/agents/lib/models'

const OCR_PROMPT = [
  'Describe this image in 1-2 sentences for a customer-service AI agent.',
  'Then transcribe any visible text verbatim.',
  'Format the output as:',
  '',
  '<summary>1-2 sentence description here.</summary>',
  '<text>verbatim transcription here</text>',
  '',
  'If there is no visible text, leave the <text> block empty.',
].join('\n')

export interface OcrResult {
  /** 1-2 sentence multimodal summary; used as the binary-image caption. */
  summary: string
  /** Verbatim transcription; used as the markdown body for image extracts. */
  text: string
}

type GenerateTextArgs = {
  model: unknown
  messages: Array<{
    role: 'user'
    content: Array<{ type: 'text'; text: string } | { type: 'image'; image: Buffer | Uint8Array; mediaType?: string }>
  }>
}
type AiSdkOpenai = {
  createOpenAI: (opts: { apiKey: string; baseURL?: string }) => { chat: (modelId: string) => unknown }
}
type AiSdk = { generateText: (args: GenerateTextArgs) => Promise<{ text: string }> }

/**
 * Lazily-resolved chat-model + `generateText` handle, cached for the process
 * lifetime. An image-heavy PDF can call ocrImage() N times per upload; without
 * memoization that's N dynamic imports + N `createOpenAI` allocations.
 */
let cachedHandle: Promise<{ model: unknown; generateText: AiSdk['generateText'] }> | null = null

function resolveCreds(): { apiKey: string; baseURL: string | undefined; modelId: string } {
  const bifrostUrl = process.env.BIFROST_URL
  const bifrostKey = process.env.BIFROST_API_KEY
  const openaiKey = process.env.OPENAI_API_KEY
  if (!bifrostKey && !openaiKey) {
    throw new Error(
      'OCR requires OPENAI_API_KEY or (BIFROST_API_KEY + BIFROST_URL). Image-heavy PDFs and image uploads will fail until one is set.',
    )
  }
  const useBifrost = Boolean(bifrostKey && bifrostUrl)
  // Bifrost dispatches on `{provider}/{model}`; direct OpenAI gets the bare
  // id (strip the `openai/` prefix from the alias map).
  const fullId = useBifrost ? 'google/gemini-2.0-flash' : models.gpt_mini
  return {
    apiKey: (useBifrost ? bifrostKey : openaiKey) as string,
    baseURL: useBifrost ? bifrostUrl : undefined,
    modelId: useBifrost ? fullId : splitModelId(fullId).model,
  }
}

function getHandle(): Promise<{ model: unknown; generateText: AiSdk['generateText'] }> {
  if (cachedHandle) return cachedHandle
  cachedHandle = (async () => {
    const creds = resolveCreds()
    // biome-ignore lint/plugin/no-dynamic-import: heavy AI SDK + provider; loaded lazily to keep the frontend bundle slim.
    const aiSdkOpenai = (await import('@ai-sdk/openai')) as unknown as AiSdkOpenai
    // biome-ignore lint/plugin/no-dynamic-import: same rationale.
    const ai = (await import('ai')) as unknown as AiSdk
    const provider = aiSdkOpenai.createOpenAI({ apiKey: creds.apiKey, baseURL: creds.baseURL })
    return { model: provider.chat(creds.modelId), generateText: ai.generateText }
  })()
  return cachedHandle
}

/**
 * OCR an image buffer. Throws when no multimodal-capable provider key is
 * configured — the message lands verbatim in `processingError` so the UI
 * tooltip can tell the operator what to set.
 */
export async function ocrImage(buffer: Buffer | Uint8Array, mimeType: string): Promise<OcrResult> {
  const { model, generateText } = await getHandle()
  const { text } = await generateText({
    model,
    messages: [
      {
        role: 'user',
        content: [
          { type: 'image', image: buffer, mediaType: mimeType },
          { type: 'text', text: OCR_PROMPT },
        ],
      },
    ],
  })
  return parseOcrText(text)
}

/** Extract `<summary>...</summary>` and `<text>...</text>` from the model output. */
export function parseOcrText(raw: string): OcrResult {
  const summaryMatch = /<summary>([\s\S]*?)<\/summary>/iu.exec(raw)
  const textMatch = /<text>([\s\S]*?)<\/text>/iu.exec(raw)
  const summary = (summaryMatch?.[1] ?? '').trim()
  const text = (textMatch?.[1] ?? '').trim()
  if (summary.length === 0 && text.length === 0) {
    // Fallback when the model didn't follow the format.
    return { summary: raw.trim().slice(0, 200), text: raw.trim() }
  }
  return { summary, text }
}
