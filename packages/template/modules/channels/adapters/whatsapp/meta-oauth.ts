/**
 * Server-side Meta OAuth helpers for the WhatsApp Embedded Signup flow.
 *
 * Two API calls live here:
 *   1. `exchangeCodeForToken` — POST `/v22.0/oauth/access_token` with the
 *      short-lived (~60s) authorization code from FB.login.
 *   2. `verifyAccessTokenViaDebugToken` — GET `/v22.0/debug_token?input_token=…`
 *      with an App access token (`{appId}|{appSecret}`). Caller asserts that
 *      `data.app_id === META_APP_ID` AND that the user-claimed `wabaId` is
 *      in `granular_scopes[].target_ids`.
 *
 * Without (2), an attacker who hijacks the FB.login callback can graft an
 * attacker-controlled WABA onto the victim org. (2) is mandatory before
 * persisting any access token.
 *
 * No request/response bodies are logged here — the helper returns shaped
 * results and throws `MetaOAuthError` on upstream failure; the caller emits
 * sanitised metadata only (kind + status code + Meta error code).
 */

const DEFAULT_API_VERSION = 'v22.0'

export interface MetaOAuthConfig {
  appId: string
  appSecret: string
  apiVersion?: string
  baseUrl?: string
}

export interface ExchangeCodeResult {
  accessToken: string
  expiresInSeconds: number | null
  tokenType: string
}

export interface DebugTokenResult {
  appId: string
  targetIds: string[]
  expiresAt: number | null
  isValid: boolean
}

export class MetaOAuthError extends Error {
  constructor(
    public readonly kind:
      | 'oauth_exchange_failed'
      | 'debug_token_failed'
      | 'wabaId_mismatch'
      | 'app_id_mismatch'
      | 'subscribe_failed'
      | 'register_failed',
    message: string,
    public readonly code: number | string,
  ) {
    super(`${kind}: ${message}`)
    this.name = 'MetaOAuthError'
  }
}

export async function exchangeCodeForToken(
  code: string,
  config: MetaOAuthConfig,
  fetchImpl: typeof fetch = globalThis.fetch,
): Promise<ExchangeCodeResult> {
  const baseUrl = config.baseUrl ?? 'https://graph.facebook.com'
  const apiVersion = config.apiVersion ?? DEFAULT_API_VERSION
  const url = `${baseUrl}/${apiVersion}/oauth/access_token`

  const body = new URLSearchParams({
    client_id: config.appId,
    client_secret: config.appSecret,
    code,
  })

  const response = await fetchImpl(url, {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body,
  })

  const json = (await response.json()) as {
    access_token?: string
    token_type?: string
    expires_in?: number
    error?: { message?: string; code?: number; type?: string; fbtrace_id?: string }
  }

  if (!response.ok || !json.access_token) {
    throw new MetaOAuthError(
      'oauth_exchange_failed',
      json.error?.message ?? `HTTP ${response.status}`,
      json.error?.code ?? response.status,
    )
  }

  return {
    accessToken: json.access_token,
    expiresInSeconds: typeof json.expires_in === 'number' ? json.expires_in : null,
    tokenType: json.token_type ?? 'bearer',
  }
}

export async function verifyAccessTokenViaDebugToken(
  accessToken: string,
  config: MetaOAuthConfig,
  fetchImpl: typeof fetch = globalThis.fetch,
): Promise<DebugTokenResult> {
  const baseUrl = config.baseUrl ?? 'https://graph.facebook.com'
  const apiVersion = config.apiVersion ?? DEFAULT_API_VERSION
  const appAccessToken = `${config.appId}|${config.appSecret}`
  const url =
    `${baseUrl}/${apiVersion}/debug_token` +
    `?input_token=${encodeURIComponent(accessToken)}` +
    `&access_token=${encodeURIComponent(appAccessToken)}`

  const response = await fetchImpl(url, { method: 'GET' })
  const json = (await response.json()) as {
    data?: {
      app_id?: string
      is_valid?: boolean
      expires_at?: number
      granular_scopes?: Array<{ scope?: string; target_ids?: string[] }>
    }
    error?: { message?: string; code?: number }
  }

  if (!response.ok || !json.data) {
    throw new MetaOAuthError(
      'debug_token_failed',
      json.error?.message ?? `HTTP ${response.status}`,
      json.error?.code ?? response.status,
    )
  }

  const data = json.data
  const targetIds = (data.granular_scopes ?? [])
    .flatMap((g) => g.target_ids ?? [])
    .filter((id, idx, arr) => typeof id === 'string' && arr.indexOf(id) === idx)

  return {
    appId: data.app_id ?? '',
    targetIds,
    expiresAt: typeof data.expires_at === 'number' ? data.expires_at : null,
    isValid: data.is_valid === true,
  }
}

export async function subscribeAppToWaba(
  wabaId: string,
  accessToken: string,
  config: MetaOAuthConfig,
  fetchImpl: typeof fetch = globalThis.fetch,
): Promise<void> {
  const baseUrl = config.baseUrl ?? 'https://graph.facebook.com'
  const apiVersion = config.apiVersion ?? DEFAULT_API_VERSION
  const url = `${baseUrl}/${apiVersion}/${encodeURIComponent(wabaId)}/subscribed_apps`
  const response = await fetchImpl(url, {
    method: 'POST',
    headers: { Authorization: `Bearer ${accessToken}` },
  })
  if (!response.ok) {
    const text = await response.text().catch(() => '')
    throw new MetaOAuthError('subscribe_failed', text || `HTTP ${response.status}`, response.status)
  }
}

export async function registerPhoneNumber(
  phoneNumberId: string,
  pin: string,
  accessToken: string,
  config: MetaOAuthConfig,
  fetchImpl: typeof fetch = globalThis.fetch,
): Promise<void> {
  const baseUrl = config.baseUrl ?? 'https://graph.facebook.com'
  const apiVersion = config.apiVersion ?? DEFAULT_API_VERSION
  const url = `${baseUrl}/${apiVersion}/${encodeURIComponent(phoneNumberId)}/register`
  const response = await fetchImpl(url, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${accessToken}` },
    body: JSON.stringify({ messaging_product: 'whatsapp', pin }),
  })
  if (!response.ok) {
    const text = await response.text().catch(() => '')
    throw new MetaOAuthError('register_failed', text || `HTTP ${response.status}`, response.status)
  }
}
