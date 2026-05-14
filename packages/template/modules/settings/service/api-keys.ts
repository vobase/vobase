/**
 * Settings-module wrapper over the better-auth `apiKey` plugin. The plugin
 * scopes list/create/delete to the caller's session, so every method threads
 * the request `Headers` rather than a bare `userId`.
 *
 * The plugin's `ApiKey` type is broad (rate-limit knobs, refill intervals,
 * permissions, …). This module projects it down to the handful of fields the
 * settings UI actually shows, so handlers + tests aren't coupled to the full
 * better-auth shape.
 */

import type { Auth } from '@auth'
import { APIError } from 'better-auth/api'

export interface ApiKeySummary {
  id: string
  name: string | null
  prefix: string | null
  start: string | null
  enabled: boolean
  lastRequest: Date | null
  createdAt: Date
}

export interface CreatedApiKey extends ApiKeySummary {
  /** Plaintext key — returned once, at creation. */
  key: string
}

type PluginApiKey = Awaited<ReturnType<Auth['api']['listApiKeys']>>['apiKeys'][number]

function toSummary(row: PluginApiKey): ApiKeySummary {
  return {
    id: row.id,
    name: row.name,
    prefix: row.prefix,
    start: row.start,
    enabled: row.enabled,
    lastRequest: row.lastRequest,
    createdAt: row.createdAt,
  }
}

export interface ApiKeysService {
  list(headers: Headers): Promise<ApiKeySummary[]>
  create(headers: Headers, name: string): Promise<CreatedApiKey>
  revoke(headers: Headers, keyId: string): Promise<boolean>
}

export function createApiKeysService(deps: { auth: Auth }): ApiKeysService {
  return {
    list: async (headers) => {
      const { apiKeys } = await deps.auth.api.listApiKeys({ headers })
      return apiKeys.map(toSummary)
    },
    create: async (headers, name) => {
      const created = await deps.auth.api.createApiKey({ body: { name }, headers })
      return { ...toSummary(created), key: created.key }
    },
    revoke: async (headers, keyId) => {
      try {
        await deps.auth.api.deleteApiKey({ body: { keyId }, headers })
        return true
      } catch (err) {
        // Only a missing key is a `false` result — let auth/DB failures
        // surface as a 500 rather than masquerading as `404 not_found`.
        if (err instanceof APIError && err.status === 'NOT_FOUND') return false
        throw err
      }
    },
  }
}

let _current: ApiKeysService | null = null
export function installApiKeysService(svc: ApiKeysService): void {
  _current = svc
}
export function __resetApiKeysServiceForTests(): void {
  _current = null
}
function current(): ApiKeysService {
  if (!_current)
    throw new Error('settings/api-keys: service not installed — call installApiKeysService() in module init')
  return _current
}

export function listKeys(headers: Headers): Promise<ApiKeySummary[]> {
  return current().list(headers)
}
export function createKey(headers: Headers, name: string): Promise<CreatedApiKey> {
  return current().create(headers, name)
}
export function revokeKey(headers: Headers, keyId: string): Promise<boolean> {
  return current().revoke(headers, keyId)
}
