/**
 * Unit tests for `provisionNotificationSettings`.
 *
 * Mocks the platform via `globalThis.fetch` (same shape as `bootstrap.test.ts`)
 * and uses a fake `ScopedDb` that records `getNotificationSettings` /
 * `upsertNotificationSettings` traffic — the only DB surface the provisioner
 * touches.
 */

import { afterEach, beforeEach, describe, expect, it, spyOn } from 'bun:test'
import * as notificationSettings from '@modules/channels/service/notification-settings'

import { provisionNotificationSettings } from './notification-provision'

const TENANT_ID = 'tst-provision'
const HMAC = 'fixture-hmac-secret'
const ORG_ID = 'org_provision'
const PLATFORM_BASE_URL = 'http://localhost:9998'
const APP_BASE_URL = 'http://tenant.example'

interface FetchCall {
  url: string
  method: string
  body: string | null
}

function patchFetch(handler: (call: FetchCall) => Response): { calls: FetchCall[]; restore: () => void } {
  const original = globalThis.fetch
  const calls: FetchCall[] = []
  const patched: typeof globalThis.fetch = (async (input, init) => {
    const url = typeof input === 'string' ? input : input instanceof URL ? input.href : input.url
    const method = (init?.method ?? 'GET').toUpperCase()
    const body = typeof init?.body === 'string' ? init.body : null
    const call = { url, method, body }
    calls.push(call)
    return handler(call)
  }) as typeof globalThis.fetch
  globalThis.fetch = Object.assign(patched, original)
  return { calls, restore: () => (globalThis.fetch = original) }
}

const ALLOCATION = {
  platformChannelId: 'pcid-prov',
  wabaId: 'waba-prov',
  phoneNumberId: 'pnid-prov',
  displayPhoneNumber: '+15550009999',
  routineSecret: 'fresh-routine-prov',
  rotationKey: 'fresh-rotation-prov',
  keyVersion: 1,
  routineSecretPrevious: null,
  rotationKeyPrevious: null,
  previousValidUntil: null,
}

describe('provisionNotificationSettings', () => {
  let restoreFetch: (() => void) | null = null
  const getMock = spyOn(notificationSettings, 'getNotificationSettings')
  const upsertMock = spyOn(notificationSettings, 'upsertNotificationSettings')

  beforeEach(() => {
    process.env.VITE_PLATFORM_URL = PLATFORM_BASE_URL
    getMock.mockReset()
    upsertMock.mockReset()
  })

  afterEach(() => {
    if (restoreFetch) {
      restoreFetch()
      restoreFetch = null
    }
  })

  it('hits notification/claim + register×2 and upserts notification_settings with all fields', async () => {
    getMock.mockResolvedValueOnce(null)
    upsertMock.mockResolvedValueOnce({} as never)

    const env = patchFetch((call) => {
      if (call.url.endsWith('/api/managed-whatsapp/notification/claim')) {
        return new Response(JSON.stringify(ALLOCATION), { status: 201 })
      }
      if (call.url.endsWith('/api/provisioning/webhook-endpoints/register')) {
        const body = JSON.parse(call.body ?? '{}') as { provider: string }
        return new Response(
          JSON.stringify({
            endpointId: body.provider === 'magic_link' ? 'ep-magic' : 'ep-notif',
            registeredAt: '2026-05-20T00:00:00Z',
          }),
          { status: 200 },
        )
      }
      return new Response('not found', { status: 404 })
    })
    restoreFetch = env.restore

    await provisionNotificationSettings({} as never, ORG_ID, {
      tenantId: TENANT_ID,
      tenantHmacSecret: HMAC,
      platformBaseUrl: PLATFORM_BASE_URL,
      appBaseUrl: APP_BASE_URL,
    })

    const claimCalls = env.calls.filter((c) => c.url.endsWith('/api/managed-whatsapp/notification/claim'))
    const registerCalls = env.calls.filter((c) => c.url.endsWith('/api/provisioning/webhook-endpoints/register'))
    expect(claimCalls).toHaveLength(1)
    expect(registerCalls).toHaveLength(2)
    const providers = registerCalls.map((c) => (JSON.parse(c.body ?? '{}') as { provider: string }).provider).sort()
    expect(providers).toEqual(['magic_link', 'whatsapp_notif'])

    expect(upsertMock).toHaveBeenCalledTimes(1)
    const upsertInput = upsertMock.mock.calls[0]?.[1]
    expect(upsertInput).toMatchObject({
      organizationId: ORG_ID,
      notificationEndpointId: 'ep-notif',
      magicLinkEndpointId: 'ep-magic',
      platformHmacSecret: ALLOCATION.routineSecret,
      platformBaseUrl: PLATFORM_BASE_URL,
      displayPhoneNumber: ALLOCATION.displayPhoneNumber,
      phoneNumberId: ALLOCATION.phoneNumberId,
      wabaId: ALLOCATION.wabaId,
    })
  })

  it('short-circuits when notification_settings row already exists (no platform POSTs)', async () => {
    getMock.mockResolvedValueOnce({ organizationId: ORG_ID } as never)
    const env = patchFetch(() => new Response('should not be called', { status: 500 }))
    restoreFetch = env.restore

    await provisionNotificationSettings({} as never, ORG_ID, {
      tenantId: TENANT_ID,
      tenantHmacSecret: HMAC,
      platformBaseUrl: PLATFORM_BASE_URL,
      appBaseUrl: APP_BASE_URL,
    })

    expect(env.calls).toHaveLength(0)
    expect(upsertMock).not.toHaveBeenCalled()
  })
})
