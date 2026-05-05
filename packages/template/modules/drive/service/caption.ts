/**
 * CaptionPort implementation. Routes through `models.gpt_mini` (OpenAI
 * gpt-5.4-mini) over Bifrost when configured, else direct OpenAI Chat
 * Completions vision. Returns `[caption pending]` when no provider is
 * configured, when the URL is invalid, on HTTP/network failure, and for
 * media types gpt-mini can't ingest (video; non-image documents).
 */

import { models, splitModelId } from '@modules/agents/lib/models'

/**
 * CaptionPort — owned by the drive module; consumed by drive itself
 * and by channel adapters for inbound media.
 */
export interface CaptionPort {
  captionImage(url: string, hint?: string): Promise<string>
  captionVideo(url: string, hint?: string): Promise<string>
  extractText(url: string, mime: string): Promise<string>
}

const CAPTION_PENDING = '[caption pending]'

const IMAGE_PROMPT =
  'Describe this image for a customer-service AI agent to know when to share it and what to say about it.'
const TEXT_PROMPT = 'Extract all text from this image verbatim.'

interface OpenAIEndpoint {
  url: string
  apiKey: string
  modelId: string
}

/**
 * Bifrost when `BIFROST_API_KEY` + `BIFROST_URL` are set (matches the wake
 * harness's `createModel`); else direct OpenAI when `OPENAI_API_KEY` is set.
 * Bifrost wants the prefixed `openai/gpt-5.4-mini` so it can dispatch;
 * direct OpenAI wants the bare `gpt-5.4-mini`.
 */
function resolveEndpoint(): OpenAIEndpoint | null {
  const bifrostKey = process.env.BIFROST_API_KEY
  const bifrostUrl = process.env.BIFROST_URL
  if (bifrostKey && bifrostUrl) {
    return {
      url: `${bifrostUrl.replace(/\/$/, '')}/v1/chat/completions`,
      apiKey: bifrostKey,
      modelId: models.gpt_mini,
    }
  }
  const openaiKey = process.env.OPENAI_API_KEY
  if (!openaiKey) return null
  return {
    url: 'https://api.openai.com/v1/chat/completions',
    apiKey: openaiKey,
    modelId: splitModelId(models.gpt_mini).model,
  }
}

export function createCaptionPort(opts?: { fetch?: typeof globalThis.fetch }): CaptionPort {
  const endpoint = resolveEndpoint()

  if (!endpoint) {
    return {
      // biome-ignore lint/suspicious/useAwait: contract requires async signature
      async captionImage(_url, _hint) {
        return CAPTION_PENDING
      },
      // biome-ignore lint/suspicious/useAwait: contract requires async signature
      async captionVideo(_url, _hint) {
        return CAPTION_PENDING
      },
      // biome-ignore lint/suspicious/useAwait: contract requires async signature
      async extractText(_url, _mime) {
        return CAPTION_PENDING
      },
    }
  }

  const fetchImpl = opts?.fetch ?? globalThis.fetch
  const { url: endpointUrl, apiKey, modelId } = endpoint

  async function callOpenAIVision(imageUrl: string, prompt: string): Promise<string> {
    try {
      // eslint-disable-next-line no-new
      new URL(imageUrl)
    } catch {
      console.warn(`[caption] invalid URL: ${imageUrl.slice(0, 80)}`)
      return CAPTION_PENDING
    }

    const body = {
      model: modelId,
      messages: [
        {
          role: 'user',
          content: [
            { type: 'text', text: prompt },
            { type: 'image_url', image_url: { url: imageUrl } },
          ],
        },
      ],
      max_tokens: 512,
    }

    try {
      const res = await fetchImpl(endpointUrl, {
        method: 'POST',
        headers: {
          'content-type': 'application/json',
          authorization: `Bearer ${apiKey}`,
        },
        body: JSON.stringify(body),
      })
      if (!res.ok) {
        console.warn(`[caption] OpenAI ${res.status} ${res.statusText}`)
        return CAPTION_PENDING
      }
      const data = (await res.json()) as {
        choices?: Array<{ message?: { content?: string } }>
      }
      return data.choices?.[0]?.message?.content?.trim() ?? CAPTION_PENDING
    } catch (err) {
      console.warn(`[caption] OpenAI fetch failed: ${err instanceof Error ? err.message : String(err)}`)
      return CAPTION_PENDING
    }
  }

  return {
    // biome-ignore lint/suspicious/useAwait: CaptionPort contract requires async signature
    async captionImage(url, hint) {
      const prompt = hint ? `${IMAGE_PROMPT} Additional context: ${hint}` : IMAGE_PROMPT
      return callOpenAIVision(url, prompt)
    },
    // biome-ignore lint/suspicious/useAwait: contract requires async signature
    async captionVideo(_url, _hint) {
      // gpt-mini doesn't ingest video. Caller should fall back to a
      // human-authored caption or skip media-aware routing for this asset.
      return CAPTION_PENDING
    },
    // biome-ignore lint/suspicious/useAwait: CaptionPort contract requires async signature
    async extractText(url, mime) {
      // PDFs and other non-image docs need a separate /v1/files upload
      // path that this port doesn't wire — return pending so callers can
      // fall back to byte-level extractors (drive/lib/extract.ts).
      if (!mime.startsWith('image/')) return CAPTION_PENDING
      return callOpenAIVision(url, TEXT_PROMPT)
    },
  }
}
