/**
 * CaptionPort unit tests.
 *
 * Two paths:
 *   stub — CAPTION_PROVIDER / GOOGLE_API_KEY unset -> returns '[caption pending]'
 *   gemini — env set, fetch injected -> calls generateContent and returns text
 *
 * The fetch injection in createCaptionPort(opts) avoids globalThis.fetch
 * mutation between tests.
 */

import { describe, expect, it } from 'bun:test'

import { createCaptionPort } from './caption'

const GEMINI_TEXT = 'A product catalog image showing various items with pricing.'

const GEMINI_RESPONSE = {
  candidates: [
    {
      content: {
        parts: [{ text: GEMINI_TEXT }],
        role: 'model',
      },
      finishReason: 'STOP',
    },
  ],
  usageMetadata: { promptTokenCount: 150, candidatesTokenCount: 12 },
}

function okJsonFetch(_url: string, _init?: RequestInit): Promise<Response> {
  return Promise.resolve(
    new Response(JSON.stringify(GEMINI_RESPONSE), {
      status: 200,
      headers: { 'content-type': 'application/json' },
    }),
  )
}

function errFetch(_url: string, _init?: RequestInit): Promise<Response> {
  return Promise.resolve(new Response('internal error', { status: 500 }))
}

function throwFetch(_url: string, _init?: RequestInit): Promise<Response> {
  return Promise.reject(new Error('network failure'))
}

/** Build a Gemini-path port with injected fetch; sets env transiently. */
function makeGeminiPort(fetchImpl = okJsonFetch as typeof globalThis.fetch) {
  const savedProvider = process.env.CAPTION_PROVIDER
  const savedKey = process.env.GOOGLE_API_KEY
  process.env.CAPTION_PROVIDER = 'gemini'
  process.env.GOOGLE_API_KEY = 'test-api-key'
  const port = createCaptionPort({ fetch: fetchImpl })
  process.env.CAPTION_PROVIDER = savedProvider
  process.env.GOOGLE_API_KEY = savedKey
  return port
}

// ---------------------------------------------------------------------------

describe('CaptionPort — stub path (env unset)', () => {
  it('captionImage returns [caption pending]', async () => {
    const port = createCaptionPort()
    expect(await port.captionImage('https://example.com/img.jpg')).toBe('[caption pending]')
  })

  it('captionVideo returns [caption pending]', async () => {
    const port = createCaptionPort()
    expect(await port.captionVideo('https://example.com/vid.mp4')).toBe('[caption pending]')
  })

  it('extractText returns [caption pending]', async () => {
    const port = createCaptionPort()
    expect(await port.extractText('https://example.com/doc.pdf', 'application/pdf')).toBe('[caption pending]')
  })
})

// ---------------------------------------------------------------------------

describe('CaptionPort — Gemini path (env set)', () => {
  it('captionImage calls Gemini generateContent and returns text', async () => {
    const port = makeGeminiPort()
    expect(await port.captionImage('https://example.com/img.jpg')).toBe(GEMINI_TEXT)
  })

  it('captionImage includes hint in prompt when provided', async () => {
    let capturedBody: unknown
    // biome-ignore lint/suspicious/useAwait: contract requires async signature
    const captureFetch = async (url: string, init?: RequestInit) => {
      capturedBody = JSON.parse((init?.body as string) ?? '{}')
      return okJsonFetch(url, init)
    }
    const port = makeGeminiPort(captureFetch as typeof globalThis.fetch)
    await port.captionImage('https://example.com/img.jpg', 'product brochure')
    const body = capturedBody as { contents: Array<{ parts: Array<{ text?: string }> }> }
    const promptPart = body.contents[0].parts.find((p) => p.text)
    expect(promptPart?.text).toContain('product brochure')
  })

  it('captionVideo calls Gemini and returns text', async () => {
    const port = makeGeminiPort()
    expect(await port.captionVideo('https://example.com/vid.mp4')).toBe(GEMINI_TEXT)
  })

  it('extractText passes mime type in fileData and returns text', async () => {
    let capturedBody: unknown
    // biome-ignore lint/suspicious/useAwait: contract requires async signature
    const captureFetch = async (url: string, init?: RequestInit) => {
      capturedBody = JSON.parse((init?.body as string) ?? '{}')
      return okJsonFetch(url, init)
    }
    const port = makeGeminiPort(captureFetch as typeof globalThis.fetch)
    const result = await port.extractText('https://example.com/doc.pdf', 'application/pdf')
    expect(result).toBe(GEMINI_TEXT)
    const body = capturedBody as {
      contents: Array<{ parts: Array<{ fileData?: { mimeType: string } }> }>
    }
    const fileDataPart = body.contents[0].parts.find((p) => p.fileData)
    expect(fileDataPart?.fileData?.mimeType).toBe('application/pdf')
  })

  it('returns [caption pending] on Gemini HTTP error', async () => {
    const port = makeGeminiPort(errFetch as typeof globalThis.fetch)
    expect(await port.captionImage('https://example.com/img.jpg')).toBe('[caption pending]')
  })

  it('returns [caption pending] on network failure', async () => {
    const port = makeGeminiPort(throwFetch as typeof globalThis.fetch)
    expect(await port.captionImage('https://example.com/img.jpg')).toBe('[caption pending]')
  })
})
