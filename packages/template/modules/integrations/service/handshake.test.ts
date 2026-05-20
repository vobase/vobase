import { afterEach, beforeEach, describe, expect, it, mock } from 'bun:test'
import { signRequest, VobaseError, verifyRequest } from '@vobase/core'

import { sha256Hex, splitPathAndQuery } from '../../channels/adapters/whatsapp/managed-transport'
import { claim, PlatformHandshakeError, release, sendNotificationTemplate, staffLinks } from './handshake'

describe('handshake v2 wire format', () => {
  it('produces a v2 payload that verifyRequest accepts with same secret', () => {
    const body = JSON.stringify({ environment: 'production', channelInstanceId: 'abc123' })
    const path = '/api/managed-whatsapp/sandbox/create'
    const { pathOnly, sortedQuery } = splitPathAndQuery(path)
    const bodyDigest = sha256Hex(body)
    const v2Payload = `POST|${pathOnly}|${sortedQuery}|${bodyDigest}`
    const secret = 'test-secret-32-chars-minimum-aaaaaa'

    const signed = signRequest({
      body: v2Payload,
      routineSecret: secret,
      rotationKey: secret,
      keyVersion: 1,
    })

    const result = verifyRequest({
      body: v2Payload,
      routineSignature: signed.routineSignature,
      rotationSignature: signed.rotationSignature,
      keyVersion: signed.keyVersion,
      maxKeyVersionSeen: 0,
      accept: [{ routineSecret: secret, rotationKey: secret, keyVersion: 1 }],
    })

    expect(result.ok).toBe(true)
  })

  it('canonicalises query strings deterministically', () => {
    const a = splitPathAndQuery('/path?b=2&a=1')
    const b = splitPathAndQuery('/path?a=1&b=2')
    expect(a.sortedQuery).toBe(b.sortedQuery)
    expect(a.pathOnly).toBe('/path')
  })

  it('handles empty query', () => {
    const r = splitPathAndQuery('/path')
    expect(r.sortedQuery).toBe('')
    expect(r.pathOnly).toBe('/path')
  })
})

// ─── Parameterized claim(kind) / release(kind) / staffLinks ─────────────────

const PLATFORM_BASE = 'http://localhost:4000'
const TEST_TENANT = 'tenant-test'
const TEST_HMAC = 'tenant-hmac-secret-32-chars-min-aaaa'

const SANDBOX_ALLOCATION = {
  platformChannelId: 'pc-sandbox-1',
  wabaId: 'waba-sb-1',
  phoneNumberId: 'pn-sb-1',
  displayPhoneNumber: '+15550001111',
  routineSecret: 'rs-sb',
  rotationKey: 'rk-sb',
  keyVersion: 1,
  routineSecretPrevious: null,
  rotationKeyPrevious: null,
  previousValidUntil: null,
}

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

const ORIGINAL_FETCH = globalThis.fetch

describe('handshake parameterized claim/release', () => {
  beforeEach(() => {
    process.env.NODE_ENV = 'test'
  })

  afterEach(() => {
    globalThis.fetch = ORIGINAL_FETCH
  })

  it('claim("sandbox") POSTs the sandbox claimPath and parses the allocation', async () => {
    const calls = installFetchStub((_url, _init) => Response.json(SANDBOX_ALLOCATION, { status: 200 }))

    const result = await claim('sandbox', {
      platformBaseUrl: PLATFORM_BASE,
      tenantId: TEST_TENANT,
      tenantHmacSecret: TEST_HMAC,
      environment: 'production',
      channelInstanceId: 'ci-1',
    })

    expect(result.platformChannelId).toBe(SANDBOX_ALLOCATION.platformChannelId)
    expect(calls).toHaveLength(1)
    expect(calls[0]?.url).toBe(`${PLATFORM_BASE}/api/managed-whatsapp/sandbox/create`)
    expect(calls[0]?.init?.method).toBe('POST')
    const headers = new Headers(calls[0]?.init?.headers)
    expect(headers.get('X-Tenant-Id')).toBe(TEST_TENANT)
    expect(headers.get('X-Vobase-Sig-Version')).toBe('2')
    expect(headers.get('X-Vobase-Routine-Sig')).toBeTruthy()
    expect(headers.get('X-Vobase-Rotation-Sig')).toBeTruthy()
  })

  it('claim() surfaces PlatformHandshakeError with status + code on platform 4xx', async () => {
    installFetchStub((_url, _init) => Response.json({ code: 'pool_exhausted' }, { status: 503 }))

    await expect(
      claim('sandbox', {
        platformBaseUrl: PLATFORM_BASE,
        tenantId: TEST_TENANT,
        tenantHmacSecret: TEST_HMAC,
        environment: 'production',
        channelInstanceId: 'ci-sb-err',
      }),
    ).rejects.toMatchObject({
      name: 'PlatformHandshakeError',
      status: 503,
      code: 'pool_exhausted',
    })
  })

  it('release("sandbox") POSTs the sandbox releasePath', async () => {
    const calls = installFetchStub((_url, _init) => Response.json({ released: true }, { status: 200 }))

    const result = await release('sandbox', {
      platformBaseUrl: PLATFORM_BASE,
      tenantId: TEST_TENANT,
      tenantHmacSecret: TEST_HMAC,
      environment: 'production',
    })

    expect(result).toEqual({ released: true })
    expect(calls[0]?.url).toBe(`${PLATFORM_BASE}/api/managed-whatsapp/tenant/release`)
  })

  it('claim() rejects when platformBaseUrl host does not match VITE_PLATFORM_URL', async () => {
    process.env.NODE_ENV = 'production'
    process.env.VITE_PLATFORM_URL = 'https://platform.example.com'
    try {
      await expect(
        claim('sandbox', {
          platformBaseUrl: 'https://attacker.example.org',
          tenantId: TEST_TENANT,
          tenantHmacSecret: TEST_HMAC,
          environment: 'production',
          channelInstanceId: 'ci-1',
        }),
      ).rejects.toBeInstanceOf(PlatformHandshakeError)
    } finally {
      process.env.NODE_ENV = 'test'
      delete process.env.VITE_PLATFORM_URL
    }
  })
})

describe('handshake staffLinks', () => {
  beforeEach(() => {
    process.env.NODE_ENV = 'test'
  })

  afterEach(() => {
    globalThis.fetch = ORIGINAL_FETCH
  })

  it('staffLinks.upsert strips leading + and POSTs wa_id form', async () => {
    const calls = installFetchStub((_url, _init) =>
      Response.json({ linked: true, staffPhoneE164: '15551234567' }, { status: 200 }),
    )

    const result = await staffLinks.upsert({
      platformBaseUrl: PLATFORM_BASE,
      tenantId: TEST_TENANT,
      tenantHmacSecret: TEST_HMAC,
      environment: 'production',
      channelInstanceId: 'ci-notif-1',
      staffUserId: 'staff-1',
      staffPhoneE164: '+15551234567',
    })

    expect(result.linked).toBe(true)
    expect(calls[0]?.url).toBe(`${PLATFORM_BASE}/api/managed-whatsapp/staff-links`)
    expect(calls[0]?.init?.method).toBe('POST')
    const body = JSON.parse(String(calls[0]?.init?.body))
    expect(body.staffPhoneE164).toBe('15551234567')
    expect(body.staffUserId).toBe('staff-1')
    expect(body.channelInstanceId).toBe('ci-notif-1')
  })

  it('staffLinks.delete uses DELETE method with v2 signed canonical payload', async () => {
    const calls = installFetchStub((_url, _init) => Response.json({ removed: true }, { status: 200 }))

    const result = await staffLinks.delete({
      platformBaseUrl: PLATFORM_BASE,
      tenantId: TEST_TENANT,
      tenantHmacSecret: TEST_HMAC,
      environment: 'production',
      staffPhoneE164: '+15551234567',
    })

    expect(result.removed).toBe(true)
    expect(calls[0]?.url).toBe(`${PLATFORM_BASE}/api/managed-whatsapp/staff-links`)
    expect(calls[0]?.init?.method).toBe('DELETE')
    const headers = new Headers(calls[0]?.init?.headers)
    expect(headers.get('X-Vobase-Sig-Version')).toBe('2')
  })

  it('staffLinks.list GETs with optional channelInstanceId filter', async () => {
    const calls = installFetchStub((_url, _init) =>
      Response.json(
        {
          links: [
            {
              staffUserId: 'staff-1',
              staffPhoneE164: '15551234567',
              channelInstanceId: 'ci-notif-1',
              linkedAt: '2026-05-12T00:00:00.000Z',
            },
          ],
        },
        { status: 200 },
      ),
    )

    const result = await staffLinks.list({
      platformBaseUrl: PLATFORM_BASE,
      tenantId: TEST_TENANT,
      tenantHmacSecret: TEST_HMAC,
      channelInstanceId: 'ci-notif-1',
    })

    expect(result).toHaveLength(1)
    expect(result[0]?.staffUserId).toBe('staff-1')
    expect(calls[0]?.url).toBe(`${PLATFORM_BASE}/api/managed-whatsapp/staff-links?channelInstanceId=ci-notif-1`)
    expect(calls[0]?.init?.method).toBe('GET')
  })
})

// ─── Stub db for within-24h (no real Postgres needed in unit tests) ──────────

/**
 * Build a minimal ScopedDb stub that makes `checkWithin24h` return the
 * supplied `within24h` value. `checkWithin24h` does a `.select().from().where().limit()`
 * chain and checks `rows.length > 0`, so we stub `select` to return that chain.
 */
function makeDbStub(within24h: boolean): import('~/runtime').ScopedDb {
  const rows = within24h ? [{ id: 'log-1' }] : []
  return {
    select: () => ({
      from: () => ({
        where: () => ({
          limit: () => Promise.resolve(rows),
        }),
      }),
    }),
  } as unknown as import('~/runtime').ScopedDb
}

const TEST_ORG = 'org-test-1'

describe('sendNotificationTemplate signature change', () => {
  beforeEach(() => {
    process.env.NODE_ENV = 'test'
  })

  afterEach(() => {
    globalThis.fetch = ORIGINAL_FETCH
  })

  it('sends templateName + positional bodyParams for vobase_inbox_mention_v2 (outside 24h → template path)', async () => {
    const calls = installFetchStub(() => Response.json({ messageId: 'msg-1' }, { status: 200 }))

    const result = await sendNotificationTemplate({
      db: makeDbStub(false),
      organizationId: TEST_ORG,
      platformBaseUrl: PLATFORM_BASE,
      tenantId: TEST_TENANT,
      tenantHmacSecret: TEST_HMAC,
      staffPhoneE164: '+15551234567',
      templateName: 'vobase_inbox_mention_v2',
      bodyParams: { agentName: 'Helpdesk', snippet: 'hi' },
      buttonUrlSuffix: 'tenant-slug',
    })

    expect(result.wireRoute).toBe('template')
    expect(calls).toHaveLength(1)
    const wireBody = JSON.parse(String(calls[0]?.init?.body))
    expect(wireBody.staffPhoneE164).toBe('+15551234567')
    expect(wireBody.templateName).toBe('vobase_inbox_mention_v2')
    expect(wireBody.bodyParams).toEqual(['Helpdesk', 'hi'])
    expect(wireBody.buttonUrlSuffix).toBe('tenant-slug')
  })

  it('sends positional bodyParams for vobase_decision_required_v2 (outside 24h)', async () => {
    const calls = installFetchStub(() => Response.json({ messageId: 'msg-2' }, { status: 200 }))

    const result = await sendNotificationTemplate({
      db: makeDbStub(false),
      organizationId: TEST_ORG,
      platformBaseUrl: PLATFORM_BASE,
      tenantId: TEST_TENANT,
      tenantHmacSecret: TEST_HMAC,
      staffPhoneE164: '+15551234567',
      templateName: 'vobase_decision_required_v2',
      bodyParams: { agentName: 'A', summary: 'B', detail: 'C' },
      buttonUrlSuffix: 'suf',
    })

    expect(result.wireRoute).toBe('template')
    const wireBody = JSON.parse(String(calls[0]?.init?.body))
    expect(wireBody.templateName).toBe('vobase_decision_required_v2')
    expect(wireBody.bodyParams).toEqual(['B', 'C', 'A'])
  })

  it('sends positional bodyParams for vobase_admin_alert_v2 (outside 24h)', async () => {
    const calls = installFetchStub(() => Response.json({ messageId: 'msg-4' }, { status: 200 }))

    const result = await sendNotificationTemplate({
      db: makeDbStub(false),
      organizationId: TEST_ORG,
      platformBaseUrl: PLATFORM_BASE,
      tenantId: TEST_TENANT,
      tenantHmacSecret: TEST_HMAC,
      staffPhoneE164: '+15551234567',
      templateName: 'vobase_admin_alert_v2',
      bodyParams: { alertHeadline: 'H', alertDetail: 'D' },
      buttonUrlSuffix: 'suf',
    })

    expect(result.wireRoute).toBe('template')
    const wireBody = JSON.parse(String(calls[0]?.init?.body))
    expect(wireBody.templateName).toBe('vobase_admin_alert_v2')
    expect(wireBody.bodyParams).toEqual(['H', 'D'])
  })

  it('throws VobaseError with code VALIDATION when bodyParams is missing required fields', async () => {
    installFetchStub(() => Response.json({ messageId: null }, { status: 200 }))

    await expect(
      sendNotificationTemplate({
        db: makeDbStub(false),
        organizationId: TEST_ORG,
        platformBaseUrl: PLATFORM_BASE,
        tenantId: TEST_TENANT,
        tenantHmacSecret: TEST_HMAC,
        staffPhoneE164: '+15551234567',
        templateName: 'vobase_decision_required_v2',
        bodyParams: { agentName: 'A' }, // missing summary + detail
        buttonUrlSuffix: 'suf',
      }),
    ).rejects.toMatchObject({ name: 'VobaseError', code: 'VALIDATION' })
  })

  it('VobaseError thrown by validation() is instance of VobaseError', async () => {
    installFetchStub(() => Response.json({ messageId: null }, { status: 200 }))

    let caught: unknown
    try {
      await sendNotificationTemplate({
        db: makeDbStub(false),
        organizationId: TEST_ORG,
        platformBaseUrl: PLATFORM_BASE,
        tenantId: TEST_TENANT,
        tenantHmacSecret: TEST_HMAC,
        staffPhoneE164: '+15551234567',
        templateName: 'vobase_decision_required_v2',
        bodyParams: { agentName: 'A' },
        buttonUrlSuffix: 'suf',
      })
    } catch (err) {
      caught = err
    }
    expect(caught).toBeInstanceOf(VobaseError)
  })

  // ─── within-24h branching stubs (US-024 / full integration tests in US-026) ─

  it('within-24h=true → POSTs to /api/whatsapp/freeform and returns wireRoute freeform', async () => {
    const calls = installFetchStub(() => Response.json({ messageId: 'msg-ff-1' }, { status: 200 }))

    const result = await sendNotificationTemplate({
      db: makeDbStub(true),
      organizationId: TEST_ORG,
      platformBaseUrl: PLATFORM_BASE,
      tenantId: TEST_TENANT,
      tenantHmacSecret: TEST_HMAC,
      staffPhoneE164: '+15551234567',
      templateName: 'vobase_inbox_mention_v2',
      bodyParams: { agentName: 'Helpdesk', snippet: 'hi' },
      buttonUrlSuffix: 'auth/magic?token=abc',
    })

    expect(result.wireRoute).toBe('freeform')
    expect(result.ok).toBe(true)
    expect(calls).toHaveLength(1)
    expect(calls[0]?.url).toContain('/api/whatsapp/freeform')
    const wireBody = JSON.parse(String(calls[0]?.init?.body))
    expect(wireBody.staffPhoneE164).toBe('+15551234567')
    expect(wireBody.bodyText).toContain('Helpdesk')
    expect(wireBody.bodyText).toContain('https://platform.vobase.dev/auth/magic?token=abc')
    expect(typeof wireBody.idempotencyKey).toBe('string')
  })

  it('within-24h=true + freeform returns meta_131047 → falls back to template with wireRoute freeform_fallback_template', async () => {
    let callCount = 0
    const calls = installFetchStub(() => {
      callCount++
      if (callCount === 1) {
        // First call: freeform endpoint returns 131047
        return Response.json({ code: 'meta_131047' }, { status: 400 })
      }
      // Second call: template endpoint succeeds
      return Response.json({ messageId: 'msg-tmpl-fallback' }, { status: 200 })
    })

    const result = await sendNotificationTemplate({
      db: makeDbStub(true),
      organizationId: TEST_ORG,
      platformBaseUrl: PLATFORM_BASE,
      tenantId: TEST_TENANT,
      tenantHmacSecret: TEST_HMAC,
      staffPhoneE164: '+15551234567',
      templateName: 'vobase_inbox_mention_v2',
      bodyParams: { agentName: 'Helpdesk', snippet: 'hi' },
      buttonUrlSuffix: 'auth/magic?token=abc',
    })

    expect(result.wireRoute).toBe('freeform_fallback_template')
    expect(result.ok).toBe(true)
    expect(calls).toHaveLength(2)
    expect(calls[0]?.url).toContain('/api/whatsapp/freeform')
    expect(calls[1]?.url).toContain('/api/managed-whatsapp/notification/send')
    // Both attempts use distinct idempotency keys derived from the same callerKey prefix
    const freeformBody = JSON.parse(String(calls[0]?.init?.body))
    const templateBody = JSON.parse(String(calls[1]?.init?.body))
    expect(freeformBody.idempotencyKey).toMatch(/^[0-9a-f-]+:freeform$/)
    expect(templateBody.idempotencyKey).toMatch(/^[0-9a-f-]+:template$/)
    // Both keys share the same callerKey UUID prefix
    const freeformPrefix = (freeformBody.idempotencyKey as string).replace(/:freeform$/, '')
    const templatePrefix = (templateBody.idempotencyKey as string).replace(/:template$/, '')
    expect(freeformPrefix).toBe(templatePrefix)
  })

  it('within-24h=true + freeform returns non-131047 4xx → throws PlatformHandshakeError without template fallback', async () => {
    const calls = installFetchStub(() => Response.json({ code: 'rate_limited' }, { status: 429 }))

    await expect(
      sendNotificationTemplate({
        db: makeDbStub(true),
        organizationId: TEST_ORG,
        platformBaseUrl: PLATFORM_BASE,
        tenantId: TEST_TENANT,
        tenantHmacSecret: TEST_HMAC,
        staffPhoneE164: '+15551234567',
        templateName: 'vobase_inbox_mention_v2',
        bodyParams: { agentName: 'Helpdesk', snippet: 'hi' },
        buttonUrlSuffix: 'suf',
      }),
    ).rejects.toMatchObject({ name: 'PlatformHandshakeError', code: 'rate_limited', status: 429 })

    // Only the freeform call was made — no template fallback
    expect(calls).toHaveLength(1)
    expect(calls[0]?.url).toContain('/api/whatsapp/freeform')
  })
})
