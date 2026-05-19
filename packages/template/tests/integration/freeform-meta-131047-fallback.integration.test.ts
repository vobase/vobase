/**
 * Integration: free-form rejected with Meta 131047 → template fallback.
 *
 * Seeds an inbound at `now - 23h55m` (inside the 23h50m safety margin but
 * close enough to the wall-clock window that Meta's edge can disagree).
 * The mock platform returns HTTP 400 `{code:'meta_131047'}` on the freeform
 * call and 200 on the template call. `sendNotificationTemplate` must:
 *   1. issue exactly 2 fetches (freeform then template),
 *   2. return the template-call payload,
 *   3. set `wireRoute='freeform_fallback_template'`.
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
const STAFF_PHONE = '+6591234569'

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

describe('freeform routing — meta 131047 fallback', () => {
  it('freeform→131047→template succeeds with wireRoute=freeform_fallback_template', async () => {
    // Inbound at now - 23h55m: inside the 23h50m local safety margin (23h55m < 23h50m
    // is false; we want INSIDE the margin so checkWithin24h returns true). Using
    // 23h45m to stay strictly inside the 23h50m window.
    await seedChannelsLogInbound(handle.db, {
      phone: STAFF_PHONE,
      createdAt: new Date(Date.now() - (23 * 60 + 45) * 60 * 1000),
    })

    const calls = installFetchStub((url) => {
      if (url.includes('/api/whatsapp/freeform')) {
        return Response.json({ code: 'meta_131047' }, { status: 400 })
      }
      if (url.includes('/api/managed-whatsapp/notification/send')) {
        return Response.json({ messageId: 'msg-tmpl-fallback' }, { status: 200 })
      }
      return Response.json({ error: 'unexpected url' }, { status: 500 })
    })

    const result = await sendNotificationTemplate({
      db: handle.db as unknown as ScopedDb,
      organizationId: TEST_ORG,
      platformBaseUrl: PLATFORM_BASE,
      tenantId: TEST_TENANT,
      tenantHmacSecret: TEST_HMAC,
      staffPhoneE164: STAFF_PHONE,
      templateName: 'vobase_decision_required_v2',
      bodyParams: { agentName: 'Helpdesk', summary: 'Refund', detail: 'context' },
      buttonUrlSuffix: 'auth/magic?token=abc&redirect=/inbox/conv-4/approvals/app-4',
    })

    expect(result.wireRoute).toBe('freeform_fallback_template')
    expect(result.ok).toBe(true)
    expect(result.messageId).toBe('msg-tmpl-fallback')

    expect(calls).toHaveLength(2)
    expect(calls[0]?.url).toContain('/api/whatsapp/freeform')
    expect(calls[1]?.url).toContain('/api/managed-whatsapp/notification/send')
  })
})
