/**
 * Integration: within-24h window routes through `/api/whatsapp/freeform`.
 *
 * Seeds `infra.channels_log` with an inbound row at `now - 2h` so
 * `checkWithin24h` returns true; the outbound send must go to the free-form
 * endpoint with `{staffPhoneE164, bodyText, idempotencyKey}` body shape.
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
const STAFF_PHONE = '+6591234567'

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

describe('freeform routing — within 24h window', () => {
  it('inbound at now-2h → POSTs /api/whatsapp/freeform, wireRoute=freeform', async () => {
    await seedChannelsLogInbound(handle.db, {
      phone: STAFF_PHONE,
      createdAt: new Date(Date.now() - 2 * 60 * 60 * 1000),
    })

    const calls = installFetchStub(() => Response.json({ messageId: 'msg-ff-1' }, { status: 200 }))

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
        approvalContext: 'Customer requested refund of $42.',
      },
      buttonUrlSuffix: 'auth/magic?token=abc&redirect=/inbox/conv-1/approvals/app-1',
    })

    expect(result.wireRoute).toBe('freeform')
    expect(result.ok).toBe(true)
    expect(calls).toHaveLength(1)
    expect(calls[0]?.url).toContain('/api/whatsapp/freeform')
    expect(calls[0]?.url).not.toContain('/notification/send')

    const body = JSON.parse(String(calls[0]?.init?.body)) as Record<string, unknown>
    expect(Object.keys(body).sort()).toEqual(['bodyText', 'idempotencyKey', 'staffPhoneE164'])
    expect(body.staffPhoneE164).toBe(STAFF_PHONE)
    expect(typeof body.bodyText).toBe('string')
    expect(typeof body.idempotencyKey).toBe('string')
  })
})
