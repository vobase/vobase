import type { VobaseDb } from '@vobase/core'

export interface SeedContext {
  app: {
    request: (url: string, init?: RequestInit) => Response | Promise<Response>
  }
  db: VobaseDb
  sessionCookie: string
  userId: string
}
