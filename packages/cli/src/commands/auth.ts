/** `vobase auth {login|whoami|logout}` subcommands. `--token=<key>` is the headless login fallback. */

import { rm } from 'node:fs/promises'
import open from 'open'

import { type Config, configPath, loadConfig, resolveConfigName, writeConfig } from '../config'
import { httpRpc } from '../transport/http'

interface AuthCommandResult {
  ok: boolean
  output: string
  exitCode: number
}

export interface AuthLoginOpts {
  configName?: string
  url?: string
  token?: string
  home?: string
  /** Override fetch for tests. */
  fetcher?: typeof fetch
  /** Override the browser-launcher (e.g., disable in tests). Default uses `open`. */
  launchBrowser?: (url: string) => Promise<void>
  /** Override the polling cadence for tests. */
  pollIntervalMs?: number
  /** Hard cap on polling time. Default 5 minutes (matches server-side TTL). */
  pollTimeoutMs?: number
  /** Override stdout/stderr writers (default process.stdout/stderr). */
  stdout?: (text: string) => void
  stderr?: (text: string) => void
}

interface CliGrantStartResponse {
  code: string
  url: string
  ttlMs: number
  expiresAt: string
}

interface CliGrantPollResponse {
  status: 'pending' | 'ready' | 'expired'
  apiKey?: string
  baseUrl?: string
}

interface WhoamiResponse {
  principal: { kind: string; id: string; email?: string }
  organizationId: string
  role: string
}

const DEFAULT_POLL_INTERVAL_MS = 2000
const DEFAULT_POLL_TIMEOUT_MS = 5 * 60 * 1000

export async function login(opts: AuthLoginOpts): Promise<AuthCommandResult> {
  const stdout = opts.stdout ?? ((s) => process.stdout.write(s))
  const stderr = opts.stderr ?? ((s) => process.stderr.write(s))
  const configName = opts.configName ?? resolveConfigName()

  if (opts.token) {
    if (!opts.url) {
      stderr('vobase auth login: --token=<key> also requires --url=<https://...>\n')
      return { ok: false, output: '', exitCode: 2 }
    }
    return await loginWithToken({ ...opts, configName, url: opts.url, token: opts.token, stdout, stderr })
  }

  if (!opts.url) {
    stderr('vobase auth login: --url=<https://acme.vobase.app> is required\n')
    return { ok: false, output: '', exitCode: 2 }
  }

  const baseUrl = opts.url
  const start = await httpRpc<CliGrantStartResponse>({
    baseUrl,
    apiKey: '',
    route: '/api/auth/cli-grant',
    body: {},
    fetcher: opts.fetcher,
  })
  if (!start.ok) {
    stderr(`vobase auth login: failed to start grant: ${start.error}\n`)
    return { ok: false, output: '', exitCode: 1 }
  }

  const grant = start.data
  stdout(`Opening ${grant.url} ...\n`)
  stdout(`If the browser doesn't open, visit that URL manually.\n`)
  stdout(`Code expires in ${Math.floor(grant.ttlMs / 60000)} minutes.\n`)

  const launch = opts.launchBrowser ?? (async (url: string) => void (await open(url)))
  try {
    await launch(grant.url)
  } catch {
    // Non-fatal — user can open the URL by hand.
  }

  const intervalMs = opts.pollIntervalMs ?? DEFAULT_POLL_INTERVAL_MS
  const timeoutMs = opts.pollTimeoutMs ?? DEFAULT_POLL_TIMEOUT_MS
  const ready = await pollForGrant({
    baseUrl,
    code: grant.code,
    intervalMs,
    timeoutMs,
    fetcher: opts.fetcher,
    stdout,
  })
  if (!ready.ok) {
    stderr(`vobase auth login: ${ready.error}\n`)
    return { ok: false, output: '', exitCode: 1 }
  }

  return await completeLogin({
    configName,
    home: opts.home,
    baseUrl: ready.baseUrl ?? baseUrl,
    apiKey: ready.apiKey,
    stdout,
    stderr,
    fetcher: opts.fetcher,
  })
}

async function pollForGrant(opts: {
  baseUrl: string
  code: string
  intervalMs: number
  timeoutMs: number
  fetcher?: typeof fetch
  stdout: (s: string) => void
}): Promise<{ ok: true; apiKey: string; baseUrl?: string } | { ok: false; error: string }> {
  const started = Date.now()
  while (Date.now() - started < opts.timeoutMs) {
    const res = await httpRpc<CliGrantPollResponse>({
      baseUrl: opts.baseUrl,
      apiKey: '',
      route: `/api/auth/cli-grant/poll?code=${encodeURIComponent(opts.code)}`,
      method: 'GET',
      fetcher: opts.fetcher,
    })
    if (res.ok) {
      if (res.data.status === 'ready' && res.data.apiKey) {
        return { ok: true, apiKey: res.data.apiKey, baseUrl: res.data.baseUrl }
      }
      // Still pending — keep waiting.
    } else if (res.errorCode === 'client_error' && res.statusCode === 404) {
      return { ok: false, error: 'grant code expired or unknown — please retry login' }
    } else if (res.errorCode === 'client_error' && res.statusCode === 410) {
      return { ok: false, error: 'grant expired — please retry login' }
    } else if (res.errorCode === 'network_error') {
      return { ok: false, error: `network error during poll: ${res.error}` }
    }
    await new Promise((r) => setTimeout(r, opts.intervalMs))
  }
  return { ok: false, error: 'timed out waiting for browser confirmation' }
}

async function loginWithToken(opts: {
  configName: string
  url: string
  token: string
  home?: string
  fetcher?: typeof fetch
  stdout: (s: string) => void
  stderr: (s: string) => void
}): Promise<AuthCommandResult> {
  return await completeLogin({
    configName: opts.configName,
    home: opts.home,
    baseUrl: opts.url,
    apiKey: opts.token,
    stdout: opts.stdout,
    stderr: opts.stderr,
    fetcher: opts.fetcher,
  })
}

async function completeLogin(opts: {
  configName: string
  home?: string
  baseUrl: string
  apiKey: string
  stdout: (s: string) => void
  stderr: (s: string) => void
  fetcher?: typeof fetch
}): Promise<AuthCommandResult> {
  const verify = await httpRpc<WhoamiResponse>({
    baseUrl: opts.baseUrl,
    apiKey: opts.apiKey,
    route: '/api/auth/whoami',
    method: 'GET',
    fetcher: opts.fetcher,
  })
  if (!verify.ok) {
    opts.stderr(`vobase auth login: token verification failed: ${verify.error}\n`)
    return { ok: false, output: '', exitCode: 1 }
  }

  const config: Config = {
    url: opts.baseUrl,
    apiKey: opts.apiKey,
    organizationId: verify.data.organizationId,
    principal: {
      id: verify.data.principal.id,
      email: verify.data.principal.email,
    },
  }
  const path = await writeConfig(config, { name: opts.configName, home: opts.home })
  opts.stdout(`Logged in as ${verify.data.principal.email ?? verify.data.principal.id}.\n`)
  opts.stdout(`Config written to ${path}\n`)
  return { ok: true, output: '', exitCode: 0 }
}

export interface AuthWhoamiOpts {
  configName?: string
  home?: string
  fetcher?: typeof fetch
  stdout?: (text: string) => void
  stderr?: (text: string) => void
}

export async function whoami(opts: AuthWhoamiOpts = {}): Promise<AuthCommandResult> {
  const stdout = opts.stdout ?? ((s) => process.stdout.write(s))
  const stderr = opts.stderr ?? ((s) => process.stderr.write(s))
  const config = await loadConfig({ flag: opts.configName, home: opts.home })
  if (!config) {
    stderr('vobase auth whoami: no config — run `vobase auth login --url=<...>` first.\n')
    return { ok: false, output: '', exitCode: 2 }
  }
  const res = await httpRpc<WhoamiResponse>({
    baseUrl: config.url,
    apiKey: config.apiKey,
    route: '/api/auth/whoami',
    method: 'GET',
    fetcher: opts.fetcher,
  })
  if (!res.ok) {
    stderr(`vobase auth whoami: ${res.error}\n`)
    return { ok: false, output: '', exitCode: 1 }
  }
  const { principal, organizationId, role } = res.data
  stdout(`Principal: ${principal.email ?? principal.id} (${principal.kind})\n`)
  stdout(`Organization: ${organizationId}\n`)
  stdout(`Role: ${role}\n`)
  stdout(`URL: ${config.url}\n`)
  return { ok: true, output: '', exitCode: 0 }
}

export interface AuthLogoutOpts {
  configName?: string
  home?: string
  stdout?: (text: string) => void
}

export async function logout(opts: AuthLogoutOpts = {}): Promise<AuthCommandResult> {
  const stdout = opts.stdout ?? ((s) => process.stdout.write(s))
  const name = opts.configName ?? resolveConfigName()
  const path = configPath(name, opts.home)
  // `force: true` swallows ENOENT — no need for a TOCTOU exists() probe.
  await rm(path, { force: true })
  stdout(`Removed ${path}.\n`)
  return { ok: true, output: '', exitCode: 0 }
}
