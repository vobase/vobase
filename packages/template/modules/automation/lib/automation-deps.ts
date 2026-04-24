import type { RealtimeService, Scheduler, VobaseDb } from '@vobase/core'

export interface ModuleDeps {
  db: VobaseDb
  scheduler: Scheduler
  realtime: RealtimeService
  auth: {
    verifyApiKey: (key: string) => Promise<{ userId: string } | null>
    createApiKey: (opts: {
      headers: Headers | Record<string, string>
      name?: string
      expiresIn?: number
    }) => Promise<{ key: string; id: string } | null>
    revokeApiKey: (keyId: string) => Promise<boolean>
  }
}

let moduleDeps: ModuleDeps | undefined

export function setModuleDeps(deps: ModuleDeps): void {
  moduleDeps = deps
}

export function getModuleDeps(): ModuleDeps {
  if (!moduleDeps) throw new Error('Automation module deps not initialized — call setModuleDeps() first')
  return moduleDeps
}

export function getModuleDb(): VobaseDb {
  if (!moduleDeps?.db) throw new Error('Automation module db not initialized — call setModuleDeps() first')
  return moduleDeps.db
}
