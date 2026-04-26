import { describe, expect, it } from 'bun:test'

import { httpRpc } from './http'

function makeFetch(handler: (req: Request) => Promise<Response> | Response): typeof fetch {
  const fn = async (input: Request | string | URL, init?: RequestInit): Promise<Response> => {
    const req = input instanceof Request ? input : new Request(input.toString(), init)
    return await handler(req)
  }
  return fn as unknown as typeof fetch
}

describe('httpRpc', () => {
  it('issues POST with Authorization header and JSON body', async () => {
    type Captured = { url: string; method: string; auth: string | null; body: string }
    const captured: Partial<Captured> = {}
    const fetcher = makeFetch(async (req) => {
      captured.url = req.url
      captured.method = req.method
      captured.auth = req.headers.get('Authorization')
      captured.body = await req.text()
      return new Response(JSON.stringify({ ok: true, data: [{ id: 'c1' }] }), {
        status: 200,
        headers: { 'Content-Type': 'application/json' },
      })
    })

    const result = await httpRpc({
      baseUrl: 'https://acme.vobase.app/',
      apiKey: 'vbt_secret',
      route: '/api/cli/contacts/list',
      body: { limit: 10 },
      fetcher,
    })

    expect(result.ok).toBe(true)
    expect(captured.url).toBe('https://acme.vobase.app/api/cli/contacts/list')
    expect(captured.method).toBe('POST')
    expect(captured.auth).toBe('Bearer vbt_secret')
    expect(captured.body).toBe('{"limit":10}')
  })

  it('joins base URLs with trailing slashes correctly', async () => {
    let url = ''
    const fetcher = makeFetch((req) => {
      url = req.url
      return new Response('{"ok":true}', { status: 200 })
    })
    await httpRpc({
      baseUrl: 'https://acme.vobase.app///',
      apiKey: 'k',
      route: 'no-leading-slash',
      fetcher,
      method: 'GET',
    })
    expect(url).toBe('https://acme.vobase.app/no-leading-slash')
  })

  it('returns errorCode unauthorized on 401', async () => {
    const fetcher = makeFetch(() => new Response('nope', { status: 401 }))
    const result = await httpRpc({ baseUrl: 'https://x', apiKey: 'k', route: '/', fetcher })
    expect(result.ok).toBe(false)
    if (!result.ok) expect(result.errorCode).toBe('unauthorized')
  })

  it('returns errorCode etag_mismatch on 412 and ships the new body as data', async () => {
    const newCatalog = { verbs: [{ name: 'fresh' }], etag: 'new' }
    const fetcher = makeFetch(
      () => new Response(JSON.stringify(newCatalog), { status: 412, headers: { 'Content-Type': 'application/json' } }),
    )
    const result = await httpRpc<typeof newCatalog>({
      baseUrl: 'https://x',
      apiKey: 'k',
      route: '/api/cli/verbs',
      ifNoneMatch: 'old-etag',
      fetcher,
      method: 'GET',
    })
    expect(result.ok).toBe(false)
    if (!result.ok && result.errorCode === 'etag_mismatch') {
      expect(result.data).toEqual(newCatalog)
    } else {
      throw new Error(`expected etag_mismatch, got ${result.ok ? 'ok' : result.errorCode}`)
    }
  })

  it('returns errorCode not_modified on 304', async () => {
    const fetcher = makeFetch(() => new Response(null, { status: 304 }))
    const result = await httpRpc({
      baseUrl: 'https://x',
      apiKey: 'k',
      route: '/api/cli/verbs',
      ifNoneMatch: 'etag-1',
      fetcher,
      method: 'GET',
    })
    expect(result.ok).toBe(false)
    if (!result.ok) expect(result.errorCode).toBe('not_modified')
  })

  it('classifies 4xx as client_error and 5xx as server_error', async () => {
    const fetcher4 = makeFetch(() => new Response('bad', { status: 400 }))
    const r4 = await httpRpc({ baseUrl: 'https://x', apiKey: 'k', route: '/', fetcher: fetcher4 })
    expect(r4.ok).toBe(false)
    if (!r4.ok) expect(r4.errorCode).toBe('client_error')

    const fetcher5 = makeFetch(() => new Response('boom', { status: 503 }))
    const r5 = await httpRpc({ baseUrl: 'https://x', apiKey: 'k', route: '/', fetcher: fetcher5 })
    expect(r5.ok).toBe(false)
    if (!r5.ok) expect(r5.errorCode).toBe('server_error')
  })

  it('returns network_error on fetch rejection', async () => {
    const fetcher = (() => {
      throw new Error('connect ECONNREFUSED')
    }) as unknown as typeof fetch
    const result = await httpRpc({ baseUrl: 'https://x', apiKey: 'k', route: '/', fetcher })
    expect(result.ok).toBe(false)
    if (!result.ok) {
      expect(result.errorCode).toBe('network_error')
      expect(result.error).toMatch(/ECONNREFUSED/)
    }
  })

  it('omits Content-Type when no body is sent', async () => {
    let ct: string | null = null
    const fetcher = makeFetch((req) => {
      ct = req.headers.get('Content-Type')
      return new Response('{"ok":true}', { status: 200 })
    })
    await httpRpc({ baseUrl: 'https://x', apiKey: 'k', route: '/', fetcher, method: 'GET' })
    expect(ct).toBeNull()
  })
})
