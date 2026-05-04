/**
 * CaptionPort unit tests.
 *
 * Two paths:
 *   stub — no provider env -> returns '[caption pending]'
 *   openai — OPENAI_API_KEY set, fetch injected -> calls Chat Completions
 *            vision and returns the assistant message text
 *
 * The fetch injection in createCaptionPort(opts) avoids globalThis.fetch
 * mutation between tests.
 */

import { describe, expect, it } from 'bun:test'

import { createCaptionPort } from './caption'

const VISION_TEXT = 'A product catalog image showing various items with pricing.'

const OPENAI_RESPONSE = {
  id: 'chatcmpl-test',
  choices: [
    {
      index: 0,
      message: { role: 'assistant', content: VISION_TEXT },
      finish_reason: 'stop',
    },
  ],
  usage: { prompt_tokens: 150, completion_tokens: 12, total_tokens: 162 },
}

function okJsonFetch(_url: string, _init?: RequestInit): Promise<Response> {
  return Promise.resolve(
    new Response(JSON.stringify(OPENAI_RESPONSE), {
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

const PROVIDER_ENV_KEYS = ['OPENAI_API_KEY', 'BIFROST_API_KEY', 'BIFROST_URL'] as const

function withProviderEnv<T>(set: Partial<Record<(typeof PROVIDER_ENV_KEYS)[number], string>>, fn: () => T): T {
  const saved: Partial<Record<(typeof PROVIDER_ENV_KEYS)[number], string | undefined>> = {}
  for (const k of PROVIDER_ENV_KEYS) saved[k] = process.env[k]
  for (const k of PROVIDER_ENV_KEYS) delete process.env[k]
  for (const [k, v] of Object.entries(set)) process.env[k] = v
  try {
    return fn()
  } finally {
    for (const k of PROVIDER_ENV_KEYS) {
      if (saved[k] === undefined) delete process.env[k]
      else process.env[k] = saved[k]
    }
  }
}

function makeOpenAIPort(fetchImpl = okJsonFetch as typeof globalThis.fetch) {
  return withProviderEnv({ OPENAI_API_KEY: 'test-api-key' }, () => createCaptionPort({ fetch: fetchImpl }))
}

function makeStubPort() {
  return withProviderEnv({}, () => createCaptionPort())
}

// ---------------------------------------------------------------------------

describe('CaptionPort — stub path (no provider env)', () => {
  it('captionImage returns [caption pending]', async () => {
    expect(await makeStubPort().captionImage('https://example.com/img.jpg')).toBe('[caption pending]')
  })

  it('captionVideo returns [caption pending]', async () => {
    expect(await makeStubPort().captionVideo('https://example.com/vid.mp4')).toBe('[caption pending]')
  })

  it('extractText returns [caption pending]', async () => {
    expect(await makeStubPort().extractText('https://example.com/doc.pdf', 'application/pdf')).toBe('[caption pending]')
  })
})

// ---------------------------------------------------------------------------

describe('CaptionPort — OpenAI path (OPENAI_API_KEY set)', () => {
  it('captionImage calls Chat Completions vision and returns text', async () => {
    const port = makeOpenAIPort()
    expect(await port.captionImage('https://example.com/img.jpg')).toBe(VISION_TEXT)
  })

  it('captionImage includes hint in prompt when provided', async () => {
    let capturedBody: unknown
    // biome-ignore lint/suspicious/useAwait: contract requires async signature
    const captureFetch = async (url: string, init?: RequestInit) => {
      capturedBody = JSON.parse((init?.body as string) ?? '{}')
      return okJsonFetch(url, init)
    }
    const port = makeOpenAIPort(captureFetch as typeof globalThis.fetch)
    await port.captionImage('https://example.com/img.jpg', 'product brochure')
    const body = capturedBody as {
      messages: Array<{ content: Array<{ type: string; text?: string }> }>
    }
    const promptPart = body.messages[0].content.find((p) => p.type === 'text')
    expect(promptPart?.text).toContain('product brochure')
  })

  it('captionImage sends image_url content with the asset URL', async () => {
    let capturedBody: unknown
    // biome-ignore lint/suspicious/useAwait: contract requires async signature
    const captureFetch = async (url: string, init?: RequestInit) => {
      capturedBody = JSON.parse((init?.body as string) ?? '{}')
      return okJsonFetch(url, init)
    }
    const port = makeOpenAIPort(captureFetch as typeof globalThis.fetch)
    await port.captionImage('https://example.com/img.jpg')
    const body = capturedBody as {
      messages: Array<{ content: Array<{ type: string; image_url?: { url: string } }> }>
    }
    const imagePart = body.messages[0].content.find((p) => p.type === 'image_url')
    expect(imagePart?.image_url?.url).toBe('https://example.com/img.jpg')
  })

  it('captionVideo always returns [caption pending] (gpt-mini cannot ingest video)', async () => {
    const port = makeOpenAIPort()
    expect(await port.captionVideo('https://example.com/vid.mp4')).toBe('[caption pending]')
  })

  it('extractText calls vision when mime is image/*', async () => {
    const port = makeOpenAIPort()
    expect(await port.extractText('https://example.com/scan.png', 'image/png')).toBe(VISION_TEXT)
  })

  it('extractText returns [caption pending] for non-image mime types', async () => {
    const port = makeOpenAIPort()
    expect(await port.extractText('https://example.com/doc.pdf', 'application/pdf')).toBe('[caption pending]')
  })

  it('returns [caption pending] on OpenAI HTTP error', async () => {
    const port = makeOpenAIPort(errFetch as typeof globalThis.fetch)
    expect(await port.captionImage('https://example.com/img.jpg')).toBe('[caption pending]')
  })

  it('returns [caption pending] on network failure', async () => {
    const port = makeOpenAIPort(throwFetch as typeof globalThis.fetch)
    expect(await port.captionImage('https://example.com/img.jpg')).toBe('[caption pending]')
  })
})

// ---------------------------------------------------------------------------

describe('CaptionPort — Bifrost routing', () => {
  it('uses Bifrost url + prefixed model id when both env vars are set', async () => {
    let capturedUrl: string | undefined
    let capturedBody: unknown
    // biome-ignore lint/suspicious/useAwait: contract requires async signature
    const captureFetch = async (url: string, init?: RequestInit) => {
      capturedUrl = url
      capturedBody = JSON.parse((init?.body as string) ?? '{}')
      return okJsonFetch(url, init)
    }
    const port = withProviderEnv({ BIFROST_API_KEY: 'bif-key', BIFROST_URL: 'http://bifrost.local' }, () =>
      createCaptionPort({ fetch: captureFetch as typeof globalThis.fetch }),
    )
    await port.captionImage('https://example.com/img.jpg')
    expect(capturedUrl).toBe('http://bifrost.local/v1/chat/completions')
    expect((capturedBody as { model: string }).model).toBe('openai/gpt-5.4-mini')
  })
})
