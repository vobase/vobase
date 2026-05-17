/**
 * Integration (critic-required): cross-key idempotency on 131047 fallback.
 *
 * Same setup as `freeform-meta-131047-fallback.integration.test.ts` but the
 * assertions target the idempotency keys carried by the two outbound bodies:
 *   - they must DIFFER (so the platform's 5-minute dedup window won't suppress
 *     the template retry as a re-attempt of the freeform call),
 *   - they must share the same `callerKey` UUID prefix,
 *   - they must end with `:freeform` and `:template` respectively.
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
const STAFF_PHONE = '+6591234570'

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

describe('freeform routing — meta 131047 cross-key dedup', () => {
  it('freeform and template attempts carry distinct keys that share a callerKey prefix', async () => {
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
      templateName: 'vobase_approval_decision',
      bodyParams: { agentName: 'Helpdesk', approvalSummary: 'Refund', approvalContext: 'context' },
      buttonUrlSuffix: 'auth/magic?token=abc&redirect=/inbox/conv-5/approvals/app-5',
    })

    expect(result.wireRoute).toBe('freeform_fallback_template')
    expect(calls).toHaveLength(2)

    const freeformBody = JSON.parse(String(calls[0]?.init?.body)) as { idempotencyKey?: string }
    const templateBody = JSON.parse(String(calls[1]?.init?.body)) as { idempotencyKey?: string }
    const freeformKey = freeformBody.idempotencyKey
    const templateKey = templateBody.idempotencyKey

    expect(typeof freeformKey).toBe('string')
    expect(typeof templateKey).toBe('string')
    // 1. Distinct keys — the platform 5-min dedup must not suppress the retry.
    expect(freeformKey).not.toBe(templateKey)
    // 2. Each carries its route-specific suffix.
    expect(freeformKey).toMatch(/:freeform$/)
    expect(templateKey).toMatch(/:template$/)
    // 3. Both share the same callerKey UUID prefix.
    const freeformPrefix = (freeformKey as string).replace(/:freeform$/, '')
    const templatePrefix = (templateKey as string).replace(/:template$/, '')
    expect(freeformPrefix).toBe(templatePrefix)
    expect(freeformPrefix).toMatch(/^[0-9a-f-]{36}$/)
  })
})
