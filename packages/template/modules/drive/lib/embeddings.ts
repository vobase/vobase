/**
 * Text-embedding helper.
 *
 * Wraps `@ai-sdk/openai`'s `embedMany` against the model named in
 * `EMBEDDING_MODEL`. Provider selection mirrors `wake/llm.ts`:
 *
 * - **Bifrost** (production) — `BIFROST_API_KEY` + `BIFROST_URL` set. Embeds
 *   through the gateway's OpenAI-compatible `/embeddings` endpoint, using the
 *   `openai/{model}` provider-prefixed id Bifrost routes on. Prod has no
 *   `OPENAI_API_KEY`, so without this the drive job records
 *   `processingError='embedding_unavailable: OPENAI_API_KEY is not set'`.
 * - **Direct** (local dev) — no Bifrost vars; talks to OpenAI with
 *   `OPENAI_API_KEY` and the bare model id.
 *
 * Reads env directly so the helper is usable outside an active wake (the drive
 * job doesn't run inside the harness).
 *
 * Internal retry on 429 / 503: 3 attempts with exponential backoff (200ms /
 * 800ms / 3.2s, plus ±25% jitter). After retries are exhausted, throws an
 * Error whose message prefixed with "embedding_unavailable: " is what the
 * job records in `processingError`.
 */

import { EMBEDDING_DIM, EMBEDDING_MODEL } from '../constants'

const MAX_RETRIES = 3
const BACKOFF_MS = [200, 800, 3200] as const
const JITTER_FRACTION = 0.25
/** OpenAI's `text-embedding-3-small` accepts ≤2048 inputs per request; stay well under to leave headroom for token-count limits. */
const MAX_BATCH_SIZE = 500

interface EmbeddingProvider {
  embedMany(input: { model: unknown; values: string[] }): Promise<{ embeddings: number[][] }>
}

let cachedProvider: EmbeddingProvider | null = null
let cachedModel: ((id: string) => unknown) | null = null

/** True when the gateway vars are set — embeddings then route through Bifrost. */
export function isBifrostMode(): boolean {
  return Boolean(process.env.BIFROST_API_KEY && process.env.BIFROST_URL)
}

/**
 * The model id to pass the SDK. Bifrost dispatches on the `{provider}/{model}`
 * prefix (same convention as `wake/llm.ts`); the direct OpenAI endpoint wants
 * the bare id.
 */
export function embeddingModelId(): string {
  return isBifrostMode() ? `openai/${EMBEDDING_MODEL}` : EMBEDDING_MODEL
}

async function loadProvider(): Promise<EmbeddingProvider> {
  if (cachedProvider) return cachedProvider
  // biome-ignore lint/plugin/no-dynamic-import: heavy AI SDK; loaded lazily so it stays out of the frontend bundle and only runs when an extraction job actually embeds.
  const ai = (await import('ai')) as unknown as {
    embedMany: (args: { model: unknown; values: string[] }) => Promise<{ embeddings: number[][] }>
  }
  cachedProvider = { embedMany: ai.embedMany }
  return cachedProvider
}

async function loadModel(): Promise<(id: string) => unknown> {
  if (cachedModel) return cachedModel
  // biome-ignore lint/plugin/no-dynamic-import: heavy OpenAI SDK; loaded lazily so it stays out of the frontend bundle.
  const mod = (await import('@ai-sdk/openai')) as unknown as {
    openai: { textEmbeddingModel: (id: string) => unknown }
    createOpenAI: (opts: { baseURL?: string; apiKey?: string }) => {
      textEmbeddingModel: (id: string) => unknown
    }
  }
  if (isBifrostMode()) {
    // Point the OpenAI-compatible SDK at the Bifrost gateway. Bifrost uses the
    // gateway key for every underlying provider, exactly like `wake/llm.ts`.
    const provider = mod.createOpenAI({
      baseURL: process.env.BIFROST_URL,
      apiKey: process.env.BIFROST_API_KEY,
    })
    cachedModel = (id: string) => provider.textEmbeddingModel(id)
  } else {
    cachedModel = (id: string) => mod.openai.textEmbeddingModel(id)
  }
  return cachedModel
}

function isRetryableError(err: unknown): boolean {
  if (!err) return false
  const status = (err as { status?: number; statusCode?: number }).status ?? (err as { statusCode?: number }).statusCode
  if (status === 429 || status === 503) return true
  // Some HTTP libraries surface the status string in the message; sniff it.
  const message = err instanceof Error ? err.message : String(err)
  return /\b(429|503|rate.?limit|too many requests|service unavailable)\b/iu.test(message)
}

function jitter(ms: number): number {
  const delta = ms * JITTER_FRACTION * (Math.random() * 2 - 1)
  return Math.max(0, ms + delta)
}

function sleep(ms: number): Promise<void> {
  return new Promise((res) => setTimeout(res, ms))
}

export interface EmbedTextsResult {
  embeddings: number[][]
  /** Total tokens consumed across the call (chars / 4 estimate, same scale as the chunker). */
  tokensUsed: number
}

async function embedBatch(texts: string[]): Promise<number[][]> {
  let lastErr: unknown
  for (let attempt = 0; attempt < MAX_RETRIES; attempt++) {
    try {
      const provider = await loadProvider()
      const modelFactory = await loadModel()
      const model = modelFactory(embeddingModelId())
      const { embeddings } = await provider.embedMany({ model, values: texts })
      if (embeddings.length !== texts.length) {
        throw new Error(`embedding count mismatch: got ${embeddings.length}, expected ${texts.length}`)
      }
      for (const e of embeddings) {
        if (e.length !== EMBEDDING_DIM) {
          throw new Error(`embedding dim mismatch: got ${e.length}, expected ${EMBEDDING_DIM}`)
        }
      }
      return embeddings
    } catch (err) {
      lastErr = err
      if (attempt < MAX_RETRIES - 1 && isRetryableError(err)) {
        await sleep(jitter(BACKOFF_MS[attempt]))
        continue
      }
      break
    }
  }
  throw new Error(lastErr instanceof Error ? lastErr.message : String(lastErr))
}

/**
 * Embed an array of strings into 1536-d vectors. Splits requests > MAX_BATCH_SIZE
 * across multiple sequential calls so a 5000-chunk doc doesn't 400 in one shot.
 * Throws after retries are exhausted; the job converts that into
 * `processingError='embedding_unavailable: ${msg}'`.
 */
export async function embedTexts(texts: string[]): Promise<EmbedTextsResult> {
  if (texts.length === 0) return { embeddings: [], tokensUsed: 0 }
  if (!isBifrostMode() && !process.env.OPENAI_API_KEY) {
    throw new Error('OPENAI_API_KEY is not set')
  }

  const tokensUsed = texts.reduce((sum, t) => sum + Math.ceil(t.length / 4), 0)
  const out: number[][] = []
  for (let i = 0; i < texts.length; i += MAX_BATCH_SIZE) {
    const slice = texts.slice(i, i + MAX_BATCH_SIZE)
    const batch = await embedBatch(slice)
    out.push(...batch)
  }
  return { embeddings: out, tokensUsed }
}

/** Encode a 1536-d vector as Postgres' `[a,b,c,...]` text format. */
export function encodeVector(values: number[]): string {
  return `[${values.join(',')}]`
}
