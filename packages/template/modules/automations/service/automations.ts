/**
 * Sole writer of the `automations` rule table.
 *
 * US-013 will implement the full CRUD surface. For US-002 this is a skeleton
 * that satisfies check:shape's AUTOMATIONS_WRITE_ALLOWED allowlist and
 * establishes the throw-proxy pattern used by cross-module callers.
 */

import type { ScopedDb } from '~/runtime'

export interface AutomationsService {
  listEnabled(input: {
    organizationId: string
  }): Promise<Array<{ id: string; name: string; eventName: string; paused: boolean }>>
}

export function createAutomationsService(deps: { db: ScopedDb }): AutomationsService {
  // eslint-disable-next-line @typescript-eslint/no-unused-vars
  const _db = deps.db
  return {
    async listEnabled() {
      return [] // US-013 fills this in
    },
  }
}

let _current: AutomationsService | null = null

export function installAutomationsService(svc: AutomationsService): void {
  _current = svc
}

export function __resetAutomationsServiceForTests(): void {
  _current = null
}

export const automationsService = new Proxy({} as AutomationsService, {
  get(_t, prop) {
    if (!_current) throw new Error(`automations service not installed (accessed: ${String(prop)})`)
    return (_current as AutomationsService)[prop as keyof AutomationsService]
  },
})
