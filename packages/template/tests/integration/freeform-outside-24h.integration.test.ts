/**
 * Integration: outside the 24h window routes through the template endpoint.
 *
 * Seeds `infra.channels_log` with an inbound row at `now - 25h` — beyond the
 * 23h50m safety margin in `checkWithin24h` — so the outbound send must hit
 * `/api/managed-whatsapp/notification/send`, not `/api/whatsapp/freeform`.
 */

import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, mock } from 'bun:test'

import { sendNotificationTemplate } from '../../modules/integrations/service/handshake'
import type { ScopedDb } from '../../runtime'
import { seedChannelsLogInbound } from '../helpers/seed-channels-log'
import { connectTestDb, resetAndSeedDb } from '../helpers/test-db'

const PLATFORM_BASE = 'http://localhost:4000'
const TEST_TENANT = 'tenant-test'
const TEST_HMAC = 'tenant-hmac-secret-32-chars-min-aaaa'
const TEST_ORG = 'org-test-1'
const STAFF_PHONE = '+6591234568'

const ORIGINAL_FETCH = globalThis.fetch
const handle = connectTestDb()

interface FetchCall {
  url: string
  init: RequestInit | undefined
}

function installFetchStub(responder: (url: string, init: RequestInit | undefined) => Response): FetchCall[] {
  const calls: FetchCall[] = []
  const stub = mock(async (input: string | URL | Request, init?: RequestInit) => {
    const url = typeof input === 'string' ? input : input instanceof URL ? input.toString() : input.url
    calls.push({ url, init })
    return responder(url, init)
  })
  globalThis.fetch = stub as unknown as typeof fetch
  return calls
}

beforeAll(async () => {
  await resetAndSeedDb()
})

afterAll(async () => {
  await handle.teardown()
})

beforeEach(() => {
  process.env.NODE_ENV = 'test'
})

afterEach(() => {
  globalThis.fetch = ORIGINAL_FETCH
})

describe('freeform routing — outside 24h window', () => {
  it('inbound at now-25h → POSTs /notification/send, wireRoute=template', async () => {
    await seedChannelsLogInbound(handle.db, {
      phone: STAFF_PHONE,
      createdAt: new Date(Date.now() - 25 * 60 * 60 * 1000),
    })

    const calls = installFetchStub(() => Response.json({ messageId: 'msg-tmpl-1' }, { status: 200 }))

    const result = await sendNotificationTemplate({
      db: handle.db as unknown as ScopedDb,
      organizationId: TEST_ORG,
      platformBaseUrl: PLATFORM_BASE,
      tenantId: TEST_TENANT,
      tenantHmacSecret: TEST_HMAC,
      staffPhoneE164: STAFF_PHONE,
      templateName: 'vobase_approval_decision',
      bodyParams: {
        agentName: 'Helpdesk',
        approvalSummary: 'New refund',
        approvalContext: 'Customer requested refund.',
      },
      buttonUrlSuffix: 'auth/magic?token=abc&redirect=/inbox/conv-2/approvals/app-2',
    })

    expect(result.wireRoute).toBe('template')
    expect(result.ok).toBe(true)
    expect(calls).toHaveLength(1)
    expect(calls[0]?.url).toContain('/api/managed-whatsapp/notification/send')
    expect(calls[0]?.url).not.toContain('/freeform')
  })
})
