import { type ApiKeySummary, type CreatedApiKey, createApiKey, listApiKeys, revokeApiKey } from '@auth/api-keys'

import type { ScopedDb } from '~/runtime'

export interface ApiKeysService {
  list(userId: string): Promise<ApiKeySummary[]>
  create(userId: string, name: string): Promise<CreatedApiKey>
  revoke(userId: string, keyId: string): Promise<boolean>
}

export function createApiKeysService(deps: { db: ScopedDb }): ApiKeysService {
  return {
    list: (userId) => listApiKeys(deps.db, userId),
    create: (userId, name) => createApiKey({ db: deps.db, userId, name }),
    revoke: (userId, keyId) => revokeApiKey(deps.db, userId, keyId),
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

export function listKeys(userId: string): Promise<ApiKeySummary[]> {
  return current().list(userId)
}
export function createKey(userId: string, name: string): Promise<CreatedApiKey> {
  return current().create(userId, name)
}
export function revokeKey(userId: string, keyId: string): Promise<boolean> {
  return current().revoke(userId, keyId)
}
