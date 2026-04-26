import { describe, expect, it } from 'bun:test'

import type { Catalog } from './catalog'
import { matchVerb, parseArgs, resolve } from './resolver'

const catalog: Catalog = {
  etag: 'e1',
  verbs: [
    {
      name: 'contacts list',
      description: 'List',
      inputSchema: { type: 'object' },
      route: '/api/cli/contacts/list',
      formatHint: 'table:cols=id',
    },
    {
      name: 'contacts show',
      description: 'Show',
      inputSchema: { type: 'object' },
      route: '/api/cli/contacts/show',
    },
    {
      name: 'contacts list pending',
      description: 'List pending',
      inputSchema: { type: 'object' },
      route: '/api/cli/contacts/list-pending',
    },
  ],
}

describe('matchVerb', () => {
  it('matches exact verb name', () => {
    const m = matchVerb(['contacts', 'list'], catalog)
    expect(m?.verb.name).toBe('contacts list')
    expect(m?.argsConsumed).toBe(2)
  })

  it('prefers longest-prefix match', () => {
    const m = matchVerb(['contacts', 'list', 'pending'], catalog)
    expect(m?.verb.name).toBe('contacts list pending')
    expect(m?.argsConsumed).toBe(3)
  })

  it('returns null when no match', () => {
    expect(matchVerb(['unknown'], catalog)).toBeNull()
  })

  it('treats trailing positional args as the verb argument tail', () => {
    const m = matchVerb(['contacts', 'show', 'c1'], catalog)
    expect(m?.verb.name).toBe('contacts show')
    expect(m?.argsConsumed).toBe(2)
  })
})

describe('parseArgs', () => {
  it('parses --key=value pairs', () => {
    expect(parseArgs(['--limit=10', '--filter=qualified'])).toEqual({ _: [], limit: '10', filter: 'qualified' })
  })

  it('parses --key value (space-separated)', () => {
    expect(parseArgs(['--limit', '10'])).toEqual({ _: [], limit: '10' })
  })

  it('treats --flag with no value as boolean true', () => {
    expect(parseArgs(['--verbose'])).toEqual({ _: [], verbose: true })
    expect(parseArgs(['--verbose', '--limit=10'])).toEqual({ _: [], verbose: true, limit: '10' })
  })

  it('captures positional args under _', () => {
    expect(parseArgs(['c1', '--segment=qualified'])).toEqual({ _: ['c1'], segment: 'qualified' })
  })
})

describe('resolve', () => {
  function fetcherReturning(status: number, body: unknown): typeof fetch {
    return (async () =>
      new Response(JSON.stringify(body), {
        status,
        headers: { 'Content-Type': 'application/json' },
      })) as unknown as typeof fetch
  }

  it('renders successful verb output via formatHint', async () => {
    const r = await resolve({
      argv: ['contacts', 'list'],
      catalog,
      baseUrl: 'https://x',
      apiKey: 'k',
      format: 'human',
      fetcher: fetcherReturning(200, { ok: true, data: [{ id: 'c1' }, { id: 'c2' }] }),
    })
    expect(r.ok).toBe(true)
    if (r.ok) {
      expect(r.output).toContain('ID')
      expect(r.output).toContain('c1')
      expect(r.output).toContain('c2')
    }
  })

  it('honours --json override', async () => {
    const r = await resolve({
      argv: ['contacts', 'list'],
      catalog,
      baseUrl: 'https://x',
      apiKey: 'k',
      format: 'json',
      fetcher: fetcherReturning(200, { ok: true, data: [{ id: 'c1' }] }),
    })
    expect(r.ok).toBe(true)
    if (r.ok) {
      expect(r.output).toBe('[\n  {\n    "id": "c1"\n  }\n]\n')
    }
  })

  it('passes positional + flag args to the server as JSON body', async () => {
    let capturedBody = ''
    const fetcher = ((_input: unknown, init?: RequestInit) => {
      capturedBody = (init?.body as string) ?? ''
      return Promise.resolve(
        new Response(JSON.stringify({ ok: true, data: { id: 'c1' } }), {
          status: 200,
          headers: { 'Content-Type': 'application/json' },
        }),
      )
    }) as unknown as typeof fetch
    const r = await resolve({
      argv: ['contacts', 'show', 'c1', '--include=tags'],
      catalog,
      baseUrl: 'https://x',
      apiKey: 'k',
      format: 'human',
      fetcher,
    })
    expect(r.ok).toBe(true)
    expect(JSON.parse(capturedBody)).toEqual({ _: ['c1'], include: 'tags' })
  })

  it('returns an unknown-verb error per spec wording', async () => {
    const r = await resolve({
      argv: ['notarealverb', 'foo'],
      catalog,
      baseUrl: 'https://x',
      apiKey: 'k',
      format: 'human',
    })
    expect(r.ok).toBe(false)
    if (!r.ok) {
      expect(r.output).toContain("Unknown verb 'notarealverb foo'")
      expect(r.output).toContain('vobase --refresh')
      expect(r.exitCode).toBe(1)
    }
  })

  it('returns auth-failure error on 401', async () => {
    const r = await resolve({
      argv: ['contacts', 'list'],
      catalog,
      baseUrl: 'https://x',
      apiKey: 'k',
      format: 'human',
      fetcher: (async () => new Response('nope', { status: 401 })) as unknown as typeof fetch,
    })
    expect(r.ok).toBe(false)
    if (!r.ok) {
      expect(r.output).toContain('Authentication failed')
      expect(r.output).toContain('vobase auth login')
      expect(r.exitCode).toBe(2)
    }
  })

  it('surfaces a verb-body error returned in the response payload', async () => {
    const r = await resolve({
      argv: ['contacts', 'show', 'missing'],
      catalog,
      baseUrl: 'https://x',
      apiKey: 'k',
      format: 'human',
      fetcher: fetcherReturning(200, { ok: false, error: 'contact not found' }),
    })
    expect(r.ok).toBe(false)
    if (!r.ok) {
      expect(r.output).toContain('contact not found')
      expect(r.exitCode).toBe(1)
    }
  })

  it('accepts a bare-payload response (no { ok, data } wrapper)', async () => {
    const r = await resolve({
      argv: ['contacts', 'list'],
      catalog,
      baseUrl: 'https://x',
      apiKey: 'k',
      format: 'json',
      fetcher: fetcherReturning(200, [{ id: 'c1' }]),
    })
    expect(r.ok).toBe(true)
    if (r.ok) expect(r.output).toContain('"id": "c1"')
  })
})
