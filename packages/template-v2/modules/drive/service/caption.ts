/**
 * CaptionPort implementation. Calls Gemini's generateContent API with the
 * prompt from the spec when `CAPTION_PROVIDER=gemini` and `GOOGLE_API_KEY`
 * are set; otherwise returns `[caption pending]`. Uses `fileData.fileUri`
 * so one HTTP call produces one caption.
 */

/**
 * CaptionPort — owned by the drive module; consumed by drive itself
 * and by channel adapters for inbound media. Implementation wraps Gemini.
 */
export interface CaptionPort {
  captionImage(url: string, hint?: string): Promise<string>
  captionVideo(url: string, hint?: string): Promise<string>
  extractText(url: string, mime: string): Promise<string>
}

const GEMINI_MODEL = 'gemini-2.0-flash'
const GEMINI_BASE = 'https://generativelanguage.googleapis.com'
const CAPTION_PENDING = '[caption pending]'

const IMAGE_PROMPT =
  'Describe this image for a customer-service AI agent to know when to share it and what to say about it.'
const VIDEO_PROMPT =
  'Describe this video for a customer-service AI agent to know when to share it and what to say about it.'
const TEXT_PROMPT = 'Extract all text from this document verbatim.'

export function createCaptionPort(opts?: { fetch?: typeof globalThis.fetch }): CaptionPort {
  const provider = process.env.CAPTION_PROVIDER
  const apiKey = process.env.GOOGLE_API_KEY

  if (!provider || !apiKey) {
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

  async function callGemini(url: string, mimeType: string, prompt: string): Promise<string> {
    try {
      // eslint-disable-next-line no-new
      new URL(url)
    } catch {
      console.warn(`[caption] invalid URL: ${url.slice(0, 80)}`)
      return CAPTION_PENDING
    }

    const body = {
      contents: [
        {
          parts: [{ fileData: { mimeType, fileUri: url } }, { text: prompt }],
          role: 'user',
        },
      ],
      generationConfig: { maxOutputTokens: 512 },
    }

    try {
      const res = await fetchImpl(`${GEMINI_BASE}/v1beta/models/${GEMINI_MODEL}:generateContent?key=${apiKey}`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify(body),
      })
      if (!res.ok) {
        console.warn(`[caption] Gemini ${res.status} ${res.statusText} for ${mimeType}`)
        return CAPTION_PENDING
      }
      const data = (await res.json()) as {
        candidates?: Array<{ content?: { parts?: Array<{ text?: string }> } }>
      }
      return data.candidates?.[0]?.content?.parts?.[0]?.text?.trim() ?? CAPTION_PENDING
    } catch (err) {
      console.warn(`[caption] Gemini fetch failed: ${err instanceof Error ? err.message : String(err)}`)
      return CAPTION_PENDING
    }
  }

  function mimeForImageUrl(url: string): string {
    const ext = url.split('?')[0]?.split('.').pop()?.toLowerCase() ?? ''
    if (ext === 'png') return 'image/png'
    if (ext === 'webp') return 'image/webp'
    if (ext === 'gif') return 'image/gif'
    if (ext === 'heic') return 'image/heic'
    return 'image/jpeg'
  }

  function mimeForVideoUrl(url: string): string {
    const ext = url.split('?')[0]?.split('.').pop()?.toLowerCase() ?? ''
    if (ext === 'webm') return 'video/webm'
    if (ext === 'mov') return 'video/quicktime'
    if (ext === 'ogg') return 'video/ogg'
    return 'video/mp4'
  }

  return {
    // biome-ignore lint/suspicious/useAwait: contract requires async signature
    async captionImage(url, hint) {
      const prompt = hint ? `${IMAGE_PROMPT} Additional context: ${hint}` : IMAGE_PROMPT
      return callGemini(url, mimeForImageUrl(url), prompt)
    },
    // biome-ignore lint/suspicious/useAwait: contract requires async signature
    async captionVideo(url, hint) {
      const prompt = hint ? `${VIDEO_PROMPT} Additional context: ${hint}` : VIDEO_PROMPT
      return callGemini(url, mimeForVideoUrl(url), prompt)
    },
    // biome-ignore lint/suspicious/useAwait: contract requires async signature
    async extractText(url, mime) {
      return callGemini(url, mime, TEXT_PROMPT)
    },
  }
}
