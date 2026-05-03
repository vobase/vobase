/**
 * OCR provider: multimodal caption + transcription via Gemini Flash through
 * `wake/llm.ts`'s `createModel` seam (Bifrost-or-direct routing).
 *
 * Returns both the verbatim transcription (`text`) and a 1-2 sentence
 * description (`summary`) — the summary is what `caption.ts` prefers when
 * deriving a UI caption for an image (raw OCR text is often noisy headers).
 */

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

/**
 * OCR an image buffer. Throws when no LLM key is configured (caller should
 * fall back to binary-stub).
 */
export async function ocrImage(buffer: Buffer | Uint8Array, mimeType: string): Promise<OcrResult> {
  // biome-ignore lint/plugin/no-dynamic-import: heavy AI SDK; loaded lazily so it stays out of the frontend bundle.
  const ai = (await import('ai')) as unknown as {
    generateText: (args: {
      model: unknown
      messages: Array<{
        role: 'user'
        content: Array<
          { type: 'text'; text: string } | { type: 'image'; image: Buffer | Uint8Array; mimeType?: string }
        >
      }>
    }) => Promise<{ text: string }>
  }
  // Lazy-load the wake-side LLM seam so this lib stays usable in unit tests
  // that stub out the dynamic import.
  // biome-ignore lint/plugin/no-dynamic-import: lazy seam through wake/llm to avoid circular import at boot.
  const wake = (await import('~/wake/llm')) as unknown as { createModel: (id?: string) => unknown }
  const model = wake.createModel('gemini/gemini-2.0-flash')

  const { text } = await ai.generateText({
    model,
    messages: [
      {
        role: 'user',
        content: [
          { type: 'image', image: buffer, mimeType },
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
