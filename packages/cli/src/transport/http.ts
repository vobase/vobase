/**
 * HTTP-RPC transport for `@vobase/cli`.
 *
 * Wraps `fetch` so verb dispatch is one typed call. The transport doesn't
 * know what verbs exist — that knowledge comes from the catalog. It just
 * POSTs JSON to the verb's `route` (from the catalog) with
 * `Authorization: Bearer <apiKey>` and parses the response.
 *
 * Status conventions:
 *   - 200 → `{ ok: true, data }`
 *   - 401 → `{ ok: false, errorCode: 'unauthorized' }` so the resolver can
 *     instruct the user to re-login
 *   - 412 → `{ ok: false, errorCode: 'etag_mismatch' }` so the catalog
 *     client knows to refetch + retry
 *   - 4xx (other) → `{ ok: false, errorCode: 'client_error', error: <body> }`
 *   - 5xx / network → `{ ok: false, errorCode: 'server_error', error: <msg> }`
 *
 * Network failures are returned as ok=false instead of throwing — every
 * caller already has to branch on ok, and an unhandled rejection during
 * verb dispatch produces a worse UX than a typed error.
 */

export interface HttpRpcResultOk<T = unknown> {
  ok: true
  data: T
  statusCode: number
}

export type HttpRpcErrorCode =
  | 'unauthorized'
  | 'not_modified'
  | 'etag_mismatch'
  | 'client_error'
  | 'server_error'
  | 'network_error'
  | 'unknown'

interface HttpRpcResultErrBase {
  ok: false
  error: string
  statusCode: number
}

/** 412 carries the fresh catalog body so the client can swap its cache transparently. */
export interface HttpRpcResultErrEtagMismatch<T> extends HttpRpcResultErrBase {
  errorCode: 'etag_mismatch'
  data: T
}

export interface HttpRpcResultErrPlain extends HttpRpcResultErrBase {
  errorCode: Exclude<HttpRpcErrorCode, 'etag_mismatch'>
}

export type HttpRpcResultErr<T = unknown> = HttpRpcResultErrEtagMismatch<T> | HttpRpcResultErrPlain
export type HttpRpcResult<T = unknown> = HttpRpcResultOk<T> | HttpRpcResultErr<T>

export interface HttpRpcOpts {
  baseUrl: string
  apiKey: string
  /** Path on the tenant deployment (e.g. `/api/cli/contacts/list`). */
  route: string
  /** Optional JSON body — sent for verb dispatch; omitted for catalog GET. */
  body?: unknown
  method?: 'GET' | 'POST'
  /** Optional If-None-Match header for catalog etag negotiation. */
  ifNoneMatch?: string
  /** Override fetch for tests. */
  fetcher?: typeof fetch
  /** Per-call timeout in ms; default 30s. */
  timeoutMs?: number
}

const DEFAULT_TIMEOUT_MS = 30_000

export async function httpRpc<T = unknown>(opts: HttpRpcOpts): Promise<HttpRpcResult<T>> {
  const { baseUrl, apiKey, route, body, method = 'POST', ifNoneMatch, fetcher = fetch } = opts
  const url = joinUrl(baseUrl, route)
  const headers: Record<string, string> = {
    Authorization: `Bearer ${apiKey}`,
    Accept: 'application/json',
  }
  if (body !== undefined) headers['Content-Type'] = 'application/json'
  if (ifNoneMatch !== undefined) headers['If-None-Match'] = ifNoneMatch

  const controller = new AbortController()
  const timeout = setTimeout(() => controller.abort(), opts.timeoutMs ?? DEFAULT_TIMEOUT_MS)
  let response: Response
  try {
    response = await fetcher(url, {
      method,
      headers,
      body: body !== undefined ? JSON.stringify(body) : undefined,
      signal: controller.signal,
    })
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err)
    return { ok: false, errorCode: 'network_error', error: message, statusCode: 0 }
  } finally {
    clearTimeout(timeout)
  }

  const statusCode = response.status

  if (statusCode === 304) {
    // Not Modified — body is intentionally empty; callers reuse their cache.
    return { ok: false, errorCode: 'not_modified', error: '', statusCode }
  }
  if (statusCode === 401) {
    return { ok: false, errorCode: 'unauthorized', error: 'Authentication failed', statusCode }
  }
  if (statusCode === 412) {
    const data = (await safeJson(response)) as T
    return { ok: false, errorCode: 'etag_mismatch', error: 'Catalog etag mismatch', statusCode, data }
  }
  if (statusCode >= 400 && statusCode < 500) {
    const error = await safeText(response)
    return { ok: false, errorCode: 'client_error', error, statusCode }
  }
  if (statusCode >= 500) {
    const error = await safeText(response)
    return { ok: false, errorCode: 'server_error', error, statusCode }
  }

  const data = (await safeJson(response)) as T
  return { ok: true, data, statusCode }
}

function joinUrl(base: string, route: string): string {
  const trimmedBase = base.replace(/\/+$/u, '')
  const prefixedRoute = route.startsWith('/') ? route : `/${route}`
  return `${trimmedBase}${prefixedRoute}`
}

async function safeText(response: Response): Promise<string> {
  try {
    return await response.text()
  } catch {
    return `(failed to read response body, status ${response.status})`
  }
}

async function safeJson(response: Response): Promise<unknown> {
  try {
    return await response.json()
  } catch {
    return null
  }
}
