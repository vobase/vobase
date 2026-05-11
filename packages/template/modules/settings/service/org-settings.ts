/**
 * Per-org generic key/value settings (org_settings table).
 *
 * Used today only for `defaultOperatorAgentId` (the agent that handles
 * first-time staff inbound on the notification-tier WhatsApp channel). Future
 * org-scoped preferences plug in here without a schema change.
 */

import { orgSettings } from '@modules/settings/schema'
import { and, eq } from 'drizzle-orm'

import type { ScopedDb } from '~/runtime'

/**
 * String-typed key union — extend as new keys are added so callers cannot
 * fat-finger the namespace.
 */
export type OrgSettingKey = 'defaultOperatorAgentId'

export interface OrgSettingsService {
  get(organizationId: string, key: OrgSettingKey): Promise<string | null>
  set(organizationId: string, key: OrgSettingKey, value: string | null): Promise<void>
}

interface OrgSettingsDeps {
  db: ScopedDb
}

export function createOrgSettingsService(deps: OrgSettingsDeps): OrgSettingsService {
  const db = deps.db

  async function get(organizationId: string, key: OrgSettingKey): Promise<string | null> {
    const rows = await db
      .select({ value: orgSettings.value })
      .from(orgSettings)
      .where(and(eq(orgSettings.organizationId, organizationId), eq(orgSettings.key, key)))
      .limit(1)
    return rows[0]?.value ?? null
  }

  async function set(organizationId: string, key: OrgSettingKey, value: string | null): Promise<void> {
    await db
      .insert(orgSettings)
      .values({ organizationId, key, value })
      .onConflictDoUpdate({
        target: [orgSettings.organizationId, orgSettings.key],
        set: { value, updatedAt: new Date() },
      })
  }

  return { get, set }
}

let _current: OrgSettingsService | null = null
export function installOrgSettingsService(svc: OrgSettingsService): void {
  _current = svc
}
export function __resetOrgSettingsServiceForTests(): void {
  _current = null
}
function current(): OrgSettingsService {
  if (!_current) throw new Error('settings/org-settings: service not installed — call installOrgSettingsService()')
  return _current
}

export const getOrgSetting = (organizationId: string, key: OrgSettingKey): Promise<string | null> =>
  current().get(organizationId, key)
export const setOrgSetting = (organizationId: string, key: OrgSettingKey, value: string | null): Promise<void> =>
  current().set(organizationId, key, value)
