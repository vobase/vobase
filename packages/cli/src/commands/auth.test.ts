import { mkdtempSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { describe, expect, it } from 'bun:test'

import { configPath, loadConfig } from '../config'
import { login, logout, whoami } from './auth'

function makeHome(): string {
  return mkdtempSync(join(tmpdir(), 'vobase-auth-test-'))
}

function makeFetcher(handler: (req: Request) => Response | Promise<Response>): typeof fetch {
  const fn = async (input: Request | string | URL, init?: RequestInit): Promise<Response> => {
    const req = input instanceof Request ? input : new Request(input.toString(), init)
    return await handler(req)
  }
  return fn as unknown as typeof fetch
}

function captureWriters() {
  const out: string[] = []
  const err: string[] = []
  return { out, err, stdout: (s: string) => out.push(s), stderr: (s: string) => err.push(s) }
}

describe('auth login', () => {
  it('completes the device-grant flow and writes a config', async () => {
    const home = makeHome()
    const writers = captureWriters()
    let opened: string | null = null
    let pollCalls = 0
    const fetcher = makeFetcher((req) => {
      const url = new URL(req.url)
      if (url.pathname === '/api/auth/cli-grant' && req.method === 'POST') {
        return new Response(
          JSON.stringify({
            code: 'g123',
            url: 'https://x.test/auth/cli-grant?code=g123',
            ttlMs: 300000,
            expiresAt: new Date(Date.now() + 300000).toISOString(),
          }),
          { status: 200, headers: { 'Content-Type': 'application/json' } },
        )
      }
      if (url.pathname === '/api/auth/cli-grant/poll' && req.method === 'GET') {
        pollCalls += 1
        if (pollCalls < 2) return new Response(JSON.stringify({ status: 'pending' }), { status: 200 })
        return new Response(JSON.stringify({ status: 'ready', apiKey: 'vbt_secret', baseUrl: 'https://x.test' }), {
          status: 200,
          headers: { 'Content-Type': 'application/json' },
        })
      }
      if (url.pathname === '/api/auth/whoami' && req.method === 'GET') {
        const auth = req.headers.get('Authorization')
        if (auth !== 'Bearer vbt_secret') return new Response('nope', { status: 401 })
        return new Response(
          JSON.stringify({
            principal: { kind: 'user', id: 'usr_1', email: 'a@b.co' },
            organizationId: 'org_1',
            role: 'owner',
          }),
          { status: 200, headers: { 'Content-Type': 'application/json' } },
        )
      }
      return new Response('not found', { status: 404 })
    })

    const result = await login({
      configName: 'acme',
      url: 'https://x.test',
      home,
      fetcher,
      pollIntervalMs: 1,
      launchBrowser: (url) => {
        opened = url
        return Promise.resolve()
      },
      stdout: writers.stdout,
      stderr: writers.stderr,
    })

    expect(result.ok).toBe(true)
    expect(result.exitCode).toBe(0)
    expect(opened).toBe('https://x.test/auth/cli-grant?code=g123')
    expect(pollCalls).toBe(2)
    const cfg = await loadConfig({ flag: 'acme', home })
    expect(cfg).not.toBeNull()
    expect(cfg?.apiKey).toBe('vbt_secret')
    expect(cfg?.organizationId).toBe('org_1')
  })

  it('aborts cleanly when the grant expires while polling', async () => {
    const home = makeHome()
    const writers = captureWriters()
    let pollCalls = 0
    const fetcher = makeFetcher((req) => {
      const url = new URL(req.url)
      if (url.pathname === '/api/auth/cli-grant') {
        return new Response(
          JSON.stringify({
            code: 'g999',
            url: 'https://x.test/auth/cli-grant?code=g999',
            ttlMs: 300000,
            expiresAt: new Date().toISOString(),
          }),
          { status: 200, headers: { 'Content-Type': 'application/json' } },
        )
      }
      if (url.pathname === '/api/auth/cli-grant/poll') {
        pollCalls += 1
        return new Response(JSON.stringify({ status: 'expired' }), { status: 410 })
      }
      return new Response('nope', { status: 404 })
    })
    const result = await login({
      configName: 'acme',
      url: 'https://x.test',
      home,
      fetcher,
      pollIntervalMs: 1,
      launchBrowser: () => Promise.resolve(),
      stdout: writers.stdout,
      stderr: writers.stderr,
    })
    expect(result.ok).toBe(false)
    expect(result.exitCode).toBe(1)
    expect(writers.err.join('')).toContain('expired')
    expect(pollCalls).toBeGreaterThan(0)
  })

  it('takes a --token short-circuit and skips polling', async () => {
    const home = makeHome()
    const writers = captureWriters()
    let pollCalls = 0
    let grantStarts = 0
    const fetcher = makeFetcher((req) => {
      const url = new URL(req.url)
      if (url.pathname === '/api/auth/cli-grant') {
        grantStarts += 1
        return new Response('{}', { status: 200 })
      }
      if (url.pathname === '/api/auth/cli-grant/poll') {
        pollCalls += 1
        return new Response('{}', { status: 200 })
      }
      if (url.pathname === '/api/auth/whoami') {
        return new Response(
          JSON.stringify({
            principal: { kind: 'user', id: 'usr_2', email: 'c@d.co' },
            organizationId: 'org_2',
            role: 'member',
          }),
          { status: 200, headers: { 'Content-Type': 'application/json' } },
        )
      }
      return new Response('not found', { status: 404 })
    })
    const result = await login({
      configName: 'acme',
      url: 'https://x.test',
      token: 'vbt_provided',
      home,
      fetcher,
      stdout: writers.stdout,
      stderr: writers.stderr,
    })
    expect(result.ok).toBe(true)
    expect(grantStarts).toBe(0)
    expect(pollCalls).toBe(0)
    const cfg = await loadConfig({ flag: 'acme', home })
    expect(cfg?.apiKey).toBe('vbt_provided')
  })

  it('errors when --token is given without --url', async () => {
    const writers = captureWriters()
    const result = await login({
      configName: 'acme',
      token: 'vbt_x',
      stdout: writers.stdout,
      stderr: writers.stderr,
    })
    expect(result.ok).toBe(false)
    expect(result.exitCode).toBe(2)
    expect(writers.err.join('')).toContain('--url')
  })

  it('errors when neither --url nor --token is given', async () => {
    const writers = captureWriters()
    const result = await login({ configName: 'acme', stdout: writers.stdout, stderr: writers.stderr })
    expect(result.ok).toBe(false)
    expect(result.exitCode).toBe(2)
    expect(writers.err.join('')).toContain('--url')
  })
})

describe('auth whoami', () => {
  it('reports principal/org/role from the configured tenant', async () => {
    const home = makeHome()
    // Seed config first via login's --token short-circuit.
    const fetcher = makeFetcher((req) => {
      const url = new URL(req.url)
      if (url.pathname === '/api/auth/whoami') {
        return new Response(
          JSON.stringify({
            principal: { kind: 'user', id: 'usr_5', email: 'e@f.co' },
            organizationId: 'org_5',
            role: 'admin',
          }),
          { status: 200, headers: { 'Content-Type': 'application/json' } },
        )
      }
      return new Response('not found', { status: 404 })
    })
    await login({
      configName: 'acme',
      url: 'https://x.test',
      token: 'vbt_z',
      home,
      fetcher,
      stdout: () => {},
      stderr: () => {},
    })

    const writers = captureWriters()
    const result = await whoami({ configName: 'acme', home, fetcher, stdout: writers.stdout, stderr: writers.stderr })
    expect(result.ok).toBe(true)
    const out = writers.out.join('')
    expect(out).toContain('e@f.co')
    expect(out).toContain('org_5')
    expect(out).toContain('admin')
  })

  it('errors with exit code 2 when no config exists', async () => {
    const home = makeHome()
    const writers = captureWriters()
    const result = await whoami({ configName: 'missing', home, stdout: writers.stdout, stderr: writers.stderr })
    expect(result.ok).toBe(false)
    expect(result.exitCode).toBe(2)
    expect(writers.err.join('')).toContain('no config')
  })
})

describe('auth logout', () => {
  it('removes the config file', async () => {
    const home = makeHome()
    const fetcher = makeFetcher(
      () =>
        new Response(
          JSON.stringify({
            principal: { kind: 'user', id: 'usr_x', email: 'x@y.co' },
            organizationId: 'org_x',
            role: 'member',
          }),
          { status: 200, headers: { 'Content-Type': 'application/json' } },
        ),
    )
    await login({
      configName: 'acme',
      url: 'https://x.test',
      token: 'vbt_q',
      home,
      fetcher,
      stdout: () => {},
      stderr: () => {},
    })
    const path = configPath('acme', home)
    expect(await Bun.file(path).exists()).toBe(true)

    const writers = captureWriters()
    const result = await logout({ configName: 'acme', home, stdout: writers.stdout })
    expect(result.ok).toBe(true)
    expect(await Bun.file(path).exists()).toBe(false)
    expect(writers.out.join('')).toContain('Removed')
  })

  it('is a no-op when no config exists', async () => {
    const home = makeHome()
    const writers = captureWriters()
    const result = await logout({ configName: 'gone', home, stdout: writers.stdout })
    expect(result.ok).toBe(true)
    expect(writers.out.join('')).toContain('already logged out')
  })
})
