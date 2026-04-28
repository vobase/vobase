/**
 * Smoke-test helpers: dev-login + cookie capture + a tiny `apiFetch` that
 * threads the captured `Cookie` header into subsequent calls. Keeps each
 * smoke script focused on its assertions instead of auth scaffolding.
 */

export interface SmokeAuth {
  /** Cookie header value to forward on subsequent fetches. */
  cookie: string
  /** Resolved user id from `dev-login`. */
  userId: string
}

/**
 * Posts `{ email }` to /api/auth/dev-login and stitches the returned
 * Set-Cookie headers into a single Cookie string. Throws on non-2xx so smoke
 * scripts fail fast with a clear message.
 */
export async function devLogin(baseUrl: string, email: string): Promise<SmokeAuth> {
  const res = await fetch(`${baseUrl}/api/auth/dev-login`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ email }),
  })
  if (res.status < 200 || res.status >= 300) {
    throw new Error(`dev-login ${res.status}: ${await res.text()}`)
  }
  const cookie = res.headers
    .getSetCookie()
    .map((c) => c.split(';')[0])
    .filter(Boolean)
    .join('; ')
  if (!cookie) throw new Error('dev-login returned no Set-Cookie headers')
  const data = (await res.json()) as { user?: { id?: string } }
  const userId = data.user?.id
  if (!userId) throw new Error(`dev-login response missing user.id: ${JSON.stringify(data)}`)
  return { cookie, userId }
}

/** Fetch wrapper that injects the auth cookie on every call. */
export function makeAuthedFetch(baseUrl: string, auth: SmokeAuth) {
  return (path: string, init: RequestInit = {}): Promise<Response> => {
    const headers = new Headers(init.headers)
    headers.set('cookie', auth.cookie)
    if (init.body && !headers.has('content-type')) {
      headers.set('content-type', 'application/json')
    }
    return fetch(`${baseUrl}${path}`, { ...init, headers })
  }
}

/**
 * Subscribe to /api/sse and resolve when a payload mentioning `match` arrives.
 * Returns an `abort()` to clean up the connection. The route ignores
 * `organizationId` query params today — sessions are untargeted — so we just
 * watch the global stream and filter by substring.
 */
export function watchSse(
  baseUrl: string,
  cookie: string,
  match: string,
): { promise: Promise<void>; abort: () => void } {
  const ctrl = new AbortController()
  const promise = new Promise<void>((resolve, reject) => {
    fetch(`${baseUrl}/api/sse`, { signal: ctrl.signal, headers: { cookie } })
      .then(async (res) => {
        const reader = res.body?.getReader()
        if (!reader) return reject(new Error('no SSE body'))
        const dec = new TextDecoder()
        while (true) {
          const { done, value } = await reader.read()
          if (done) break
          if (dec.decode(value).includes(match)) {
            resolve()
            return
          }
        }
        reject(new Error('SSE stream closed without match'))
      })
      .catch((e) => {
        if ((e as { name?: string }).name !== 'AbortError') reject(e as Error)
      })
  })
  return { promise, abort: () => ctrl.abort() }
}
