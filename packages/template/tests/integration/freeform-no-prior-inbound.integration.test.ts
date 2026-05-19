/**
 * Integration: no prior inbound from the staff phone → template path.
 *
 * Leaves `infra.channels_log` empty for the test phone so `checkWithin24h`
 * returns false on the first send. The send must hit
 * `/api/managed-whatsapp/notification/send`, never `/api/whatsapp/freeform`.
 */

import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, mock } from 'bun:test'

import { sendNotificationTemplate } from '../../modules/integrations/service/handshake'
import type { ScopedDb } from '../../runtime'
import { connectTestDb, resetAndSeedDb } from '../helpers/test-db'

const PLATFORM_BASE = 'http://localhost:4000'
const TEST_TENANT = 'tenant-test'
const TEST_HMAC = 'tenant-hmac-secret-32-chars-min-aaaa'
const TEST_ORG = 'org-test-1'
// Use a deliberately unused E.164 so the seeded DB has no inbound from it.
const STAFF_PHONE = '+6599999001'

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

describe('freeform routing — no prior inbound', () => {
  it('empty channels_log → POSTs /notification/send, wireRoute=template', async () => {
    const calls = installFetchStub(() => Response.json({ messageId: 'msg-tmpl-empty' }, { status: 200 }))

    const result = await sendNotificationTemplate({
      db: handle.db as unknown as ScopedDb,
      organizationId: TEST_ORG,
      platformBaseUrl: PLATFORM_BASE,
      tenantId: TEST_TENANT,
      tenantHmacSecret: TEST_HMAC,
      staffPhoneE164: STAFF_PHONE,
      templateName: 'vobase_decision_required_v2',
      bodyParams: { agentName: 'Helpdesk', summary: 'New refund', detail: 'No prior inbound.' },
      buttonUrlSuffix: 'auth/magic?token=abc&redirect=/inbox/conv-3/approvals/app-3',
    })

    expect(result.wireRoute).toBe('template')
    expect(result.ok).toBe(true)
    expect(calls).toHaveLength(1)
    expect(calls[0]?.url).toContain('/api/managed-whatsapp/notification/send')
    expect(calls[0]?.url).not.toContain('/freeform')
  })
})
