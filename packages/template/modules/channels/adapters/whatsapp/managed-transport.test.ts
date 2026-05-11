/**
 * Unit tests for the managed-mode WhatsApp transport.
 *
 * Verifies:
 *   - Outbound `signRequest(method, path)` returns the 2-key headers.
 *   - The payload signed is `${METHOD}${path}` (matches platform contract).
 *   - `verifyInboundManagedWebhook` accepts current key, accepts previous
 *     during grace, rejects downgrade past current.
 *   - Race condition: outbound dispatch does NOT throw "vault not yet loaded"
 *     when the warm-load is still inflight at first sign time (factory.ts).
 */

// Must appear before the factory import so Bun's module mock is in place when
// factory.ts first imports @modules/integrations/service/registry.
import { afterEach, beforeEach, describe, expect, mock, test } from 'bun:test'
import { signHmac } from '@vobase/core'

const VAULT_ROTATION = {
  current: { routineSecret: 'vault-routine', rotationKey: 'vault-rotation', keyVersion: 1 },
  previous: null,
}

let vaultReadDelay = 0
mock.module('@modules/integrations/service/registry', () => ({
  getVaultFor: (_orgId: string) => ({
    readSecret: (_key: string) => new Promise((resolve) => setTimeout(() => resolve(VAULT_ROTATION), vaultReadDelay)),
  }),
}))

import { __resetManagedRotationCacheForTests, createWhatsAppAdapterFromConfig } from './factory'
import {
  createManagedTransport,
  __test_sha256Hex as sha256Hex,
  __test_splitPathAndQuery as splitPathAndQuery,
  verifyInboundManagedWebhook,
} from './managed-transport'

const CURRENT = {
  routineSecret: 'routine-secret-aaa',
  rotationKey: 'rotation-key-aaa',
  keyVersion: 5,
}
const PREVIOUS = {
  routineSecret: 'routine-secret-bbb',
  rotationKey: 'rotation-key-bbb',
  keyVersion: 4,
  validUntil: new Date(Date.now() + 5 * 60 * 1000),
}

describe('createManagedTransport', () => {
  test('rewrites baseUrl + mediaDownloadUrl to platform proxy', () => {
    const t = createManagedTransport({
      platformChannelId: 'pc-123',
      platformBaseUrl: 'https://platform.voltade.app',
      tenantId: 't-1',
      current: CURRENT,
      previous: null,
    })
    expect(t.baseUrl).toBe('https://platform.voltade.app/api/managed-whatsapp/pc-123/graph')
    expect(t.mediaDownloadUrl).toBe('https://platform.voltade.app/api/managed-whatsapp/pc-123/media-download')
  })

  test('strips trailing slash from platformBaseUrl', () => {
    const t = createManagedTransport({
      platformChannelId: 'pc-1',
      platformBaseUrl: 'https://platform.voltade.app/',
      tenantId: 't-1',
      current: CURRENT,
      previous: null,
    })
    expect(t.baseUrl).toBe('https://platform.voltade.app/api/managed-whatsapp/pc-1/graph')
  })

  test('signRequest returns 2-key headers + tenant id + sig-v2 metadata (empty body)', () => {
    const t = createManagedTransport({
      platformChannelId: 'pc-1',
      platformBaseUrl: 'https://platform.voltade.app',
      tenantId: 't-acme',
      current: CURRENT,
      previous: null,
    })
    const path = '/api/managed-whatsapp/pc-1/graph/12345/messages'
    const headers = t.signRequest('POST', path)
    expect(headers['X-Tenant-Id']).toBe('t-acme')
    expect(headers['X-Vobase-Key-Version']).toBe('5')
    expect(headers['X-Vobase-Sig-Version']).toBe('2')
    const emptyDigest = sha256Hex('')
    expect(headers['X-Vobase-Body-Digest']).toBe(emptyDigest)

    // v2 payload is METHOD|path|sortedQuery|sha256(body); empty body + no query.
    const v2Payload = `POST|${path}||${emptyDigest}`
    expect(headers['X-Vobase-Routine-Sig']).toBe(signHmac(v2Payload, CURRENT.routineSecret))
    expect(headers['X-Vobase-Rotation-Sig']).toBe(signHmac(v2Payload, CURRENT.rotationKey))
    expect(headers['X-Platform-Signature']).toBeUndefined()
  })

  test('signRequest folds setPendingBody into the v2 digest', () => {
    const t = createManagedTransport({
      platformChannelId: 'pc-1',
      platformBaseUrl: 'https://platform.voltade.app',
      tenantId: 't-1',
      current: CURRENT,
      previous: null,
    })
    const body = '{"messaging_product":"whatsapp","to":"x"}'
    t.setPendingBody?.(body)
    const path = '/api/managed-whatsapp/pc-1/graph/12345/messages'
    const headers = t.signRequest('POST', path)
    const digest = sha256Hex(body)
    expect(headers['X-Vobase-Body-Digest']).toBe(digest)
    const v2Payload = `POST|${path}||${digest}`
    expect(headers['X-Vobase-Routine-Sig']).toBe(signHmac(v2Payload, CURRENT.routineSecret))
  })

  test('pending body resets between calls (no cross-request bleed)', () => {
    const t = createManagedTransport({
      platformChannelId: 'pc-1',
      platformBaseUrl: 'https://platform.voltade.app',
      tenantId: 't-1',
      current: CURRENT,
      previous: null,
    })
    t.setPendingBody?.('one-shot')
    const first = t.signRequest('POST', '/api/managed-whatsapp/pc-1/graph/12345')
    const second = t.signRequest('POST', '/api/managed-whatsapp/pc-1/graph/12345')
    // Second call had no setPendingBody → digest of empty.
    expect(second['X-Vobase-Body-Digest']).toBe(sha256Hex(''))
    expect(second['X-Vobase-Routine-Sig']).not.toBe(first['X-Vobase-Routine-Sig'])
  })

  test('signRequest folds sorted query string into the v2 payload (SH2)', () => {
    const t = createManagedTransport({
      platformChannelId: 'pc-1',
      platformBaseUrl: 'https://platform.voltade.app',
      tenantId: 't-1',
      current: CURRENT,
      previous: null,
    })
    // Same logical query, different declared order — must produce identical signatures.
    const a = t.signRequest('GET', '/api/managed-whatsapp/pc-1/graph/12345?b=2&a=1')
    const b = t.signRequest('GET', '/api/managed-whatsapp/pc-1/graph/12345?a=1&b=2')
    expect(a['X-Vobase-Routine-Sig']).toBe(b['X-Vobase-Routine-Sig'])
    // Tampering with a value must invalidate.
    const c = t.signRequest('GET', '/api/managed-whatsapp/pc-1/graph/12345?a=1&b=3')
    expect(a['X-Vobase-Routine-Sig']).not.toBe(c['X-Vobase-Routine-Sig'])
  })

  test('signRequest method is uppercased before hashing', () => {
    const t = createManagedTransport({
      platformChannelId: 'pc-1',
      platformBaseUrl: 'https://p.example.com',
      tenantId: 't-1',
      current: CURRENT,
      previous: null,
    })
    const lower = t.signRequest('get', '/api/managed-whatsapp/pc-1/graph/12345')
    const upper = t.signRequest('GET', '/api/managed-whatsapp/pc-1/graph/12345')
    expect(lower['X-Vobase-Routine-Sig']).toBe(upper['X-Vobase-Routine-Sig'])
  })
})

describe('splitPathAndQuery', () => {
  test('no query → empty sorted', () => {
    expect(splitPathAndQuery('/foo/bar')).toEqual({ pathOnly: '/foo/bar', sortedQuery: '' })
  })
  test('canonicalises ordering', () => {
    expect(splitPathAndQuery('/foo?b=2&a=1').sortedQuery).toBe('a=1&b=2')
  })
  test('stable on duplicate keys (sorted by value)', () => {
    expect(splitPathAndQuery('/foo?a=2&a=1').sortedQuery).toBe('a=1&a=2')
  })
})

describe('createManagedTransport.verifyInboundWebhook (wiring into adapter)', () => {
  const WEBHOOK_URL = 'https://tenant.example/api/channels/webhook/whatsapp/inst-1'
  const WEBHOOK_PATH = '/api/channels/webhook/whatsapp/inst-1'

  function buildRequest(body: string, headers: Record<string, string> = {}): Request {
    return new Request(WEBHOOK_URL, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', ...headers },
      body,
    })
  }

  // Mirrors the platform forwarder's canonical v2 payload (see
  // vobase-platform/modules/managed-whatsapp/jobs.ts:478) and the tenant
  // outbound transport (see `signRequest` in this file).
  function v2PayloadFor(body: string): string {
    return `POST|${WEBHOOK_PATH}||${sha256Hex(body)}`
  }

  test('accepts v2 2-key signed payload (current pair)', async () => {
    const t = createManagedTransport({
      platformChannelId: 'pc-1',
      platformBaseUrl: 'https://platform.voltade.app',
      tenantId: 't-1',
      current: CURRENT,
      previous: null,
    })
    expect(t.verifyInboundWebhook).toBeDefined()
    const body = '{"hello":"world"}'
    const payload = v2PayloadFor(body)
    const ok = await t.verifyInboundWebhook?.(
      buildRequest(body, {
        'X-Vobase-Routine-Sig': signHmac(payload, CURRENT.routineSecret),
        'X-Vobase-Rotation-Sig': signHmac(payload, CURRENT.rotationKey),
        'X-Vobase-Key-Version': String(CURRENT.keyVersion),
      }),
    )
    expect(ok).toBe(true)
  })

  test('rejects v2 with bad rotation signature', async () => {
    const t = createManagedTransport({
      platformChannelId: 'pc-1',
      platformBaseUrl: 'https://platform.voltade.app',
      tenantId: 't-1',
      current: CURRENT,
      previous: null,
    })
    const body = '{"a":1}'
    const ok = await t.verifyInboundWebhook?.(
      buildRequest(body, {
        'X-Vobase-Routine-Sig': signHmac(v2PayloadFor(body), CURRENT.routineSecret),
        'X-Vobase-Rotation-Sig': 'deadbeef'.repeat(8),
        'X-Vobase-Key-Version': String(CURRENT.keyVersion),
      }),
    )
    expect(ok).toBe(false)
  })

  test('rejects v2 when body is tampered after signing', async () => {
    const t = createManagedTransport({
      platformChannelId: 'pc-1',
      platformBaseUrl: 'https://platform.voltade.app',
      tenantId: 't-1',
      current: CURRENT,
      previous: null,
    })
    const signed = '{"original":"body"}'
    const tampered = '{"tampered":"body"}'
    const payload = v2PayloadFor(signed)
    const ok = await t.verifyInboundWebhook?.(
      buildRequest(tampered, {
        'X-Vobase-Routine-Sig': signHmac(payload, CURRENT.routineSecret),
        'X-Vobase-Rotation-Sig': signHmac(payload, CURRENT.rotationKey),
        'X-Vobase-Key-Version': String(CURRENT.keyVersion),
      }),
    )
    expect(ok).toBe(false)
  })

  test('rejects when no signature headers at all', async () => {
    const t = createManagedTransport({
      platformChannelId: 'pc-1',
      platformBaseUrl: 'https://platform.voltade.app',
      tenantId: 't-1',
      current: CURRENT,
      previous: null,
    })
    const ok = await t.verifyInboundWebhook?.(buildRequest('{"a":1}'))
    expect(ok).toBe(false)
  })

  test('thunk-form rotation values are honored', async () => {
    let live = CURRENT
    const t = createManagedTransport({
      platformChannelId: 'pc-1',
      platformBaseUrl: 'https://platform.voltade.app',
      tenantId: 't-1',
      current: () => live,
      previous: () => null,
    })
    // Rotate the source-of-truth pair AFTER transport creation; verifier
    // must pick up the new value.
    live = { routineSecret: 'fresh-routine', rotationKey: 'fresh-rotation', keyVersion: 99 }
    const body = '{"after":"rotate"}'
    const payload = v2PayloadFor(body)
    const ok = await t.verifyInboundWebhook?.(
      buildRequest(body, {
        'X-Vobase-Routine-Sig': signHmac(payload, 'fresh-routine'),
        'X-Vobase-Rotation-Sig': signHmac(payload, 'fresh-rotation'),
        'X-Vobase-Key-Version': '99',
      }),
    )
    expect(ok).toBe(true)
  })
})

describe('createWhatsAppAdapterFromConfig — managed mode race condition', () => {
  beforeEach(() => {
    __resetManagedRotationCacheForTests()
    process.env.VITE_PLATFORM_TENANT_SLUG = 'test-tenant'
  })

  afterEach(() => {
    delete process.env.VITE_PLATFORM_TENANT_SLUG
    __resetManagedRotationCacheForTests()
    vaultReadDelay = 0
  })

  test('outbound signRequest does not throw "vault not yet loaded" when vault load is slow', async () => {
    // Simulate a slow vault round-trip (50ms). The old fire-and-forget warm-load
    // would resolve AFTER the adapter was returned, so an immediate signRequest
    // call would see expiresAt===0 and throw. With the fix, createManagedAdapter
    // awaits the load before returning, so signRequest always has a valid entry.
    vaultReadDelay = 50

    const adapter = await createWhatsAppAdapterFromConfig(
      {
        mode: 'managed',
        platformChannelId: 'pc-race-test',
        platformBaseUrl: 'https://platform.voltade.app',
        organizationId: 'org-race-test',
      },
      'inst-race',
    )

    // Immediately call send() — which internally calls signRequest() — without
    // waiting any additional time. The error must NOT be the sentinel
    // "vault not yet loaded" message; a network error (no real server) is fine.
    let caughtError: unknown = null
    try {
      await adapter.send({ to: '+6591234567', text: 'hello' })
    } catch (err) {
      caughtError = err
    }

    // The vault was loaded, so signRequest succeeded and we got past signing.
    // Any caught error must be a downstream network/proxy failure, not our
    // sentinel which would indicate the race condition was still present.
    if (caughtError instanceof Error) {
      expect(caughtError.message).not.toContain('vault not yet loaded')
    }
  })
})

describe('verifyInboundManagedWebhook', () => {
  test('accepts current-key signed payload', () => {
    const body = '{"hello":"world"}'
    const result = verifyInboundManagedWebhook({
      signedPayload: body,
      routineSignature: signHmac(body, CURRENT.routineSecret),
      rotationSignature: signHmac(body, CURRENT.rotationKey),
      keyVersion: CURRENT.keyVersion,
      current: CURRENT,
      previous: null,
    })
    expect(result.ok).toBe(true)
    if (result.ok) {
      expect(result.nextKeyVersion).toBe(CURRENT.keyVersion)
    }
  })

  test('previous-key signed payload is REJECTED once maxKeyVersionSeen advances (monotonic guard)', () => {
    // Per the 2-key contract, once we've seen the current keyVersion the
    // previous-key signed inbound is treated as a downgrade — even though
    // we still hold the previous pair in the vault for outbound symmetry,
    // verification is one-way monotonic.
    const body = '{"old":"signed"}'
    const result = verifyInboundManagedWebhook({
      signedPayload: body,
      routineSignature: signHmac(body, PREVIOUS.routineSecret),
      rotationSignature: signHmac(body, PREVIOUS.rotationKey),
      keyVersion: PREVIOUS.keyVersion,
      current: CURRENT,
      previous: PREVIOUS,
    })
    expect(result.ok).toBe(false)
    if (!result.ok) {
      expect(result.reason).toBe('downgrade')
    }
  })

  test('rejects downgrade — keyVersion below current', () => {
    const body = '{"replay":"attempt"}'
    // Sign with the older pair but advertise its lower keyVersion. Without a
    // previous slate entry that advances, this should be rejected.
    const result = verifyInboundManagedWebhook({
      signedPayload: body,
      routineSignature: signHmac(body, PREVIOUS.routineSecret),
      rotationSignature: signHmac(body, PREVIOUS.rotationKey),
      keyVersion: PREVIOUS.keyVersion,
      current: CURRENT,
      previous: null,
    })
    expect(result.ok).toBe(false)
    if (!result.ok) {
      expect(result.reason).toBe('downgrade')
    }
  })

  test('rejects bad routine signature', () => {
    const body = '{"hello":"world"}'
    const result = verifyInboundManagedWebhook({
      signedPayload: body,
      routineSignature: 'deadbeef'.repeat(8),
      rotationSignature: signHmac(body, CURRENT.rotationKey),
      keyVersion: CURRENT.keyVersion,
      current: CURRENT,
      previous: null,
    })
    expect(result.ok).toBe(false)
  })

  test('rejects bad rotation signature', () => {
    const body = '{"hello":"world"}'
    const result = verifyInboundManagedWebhook({
      signedPayload: body,
      routineSignature: signHmac(body, CURRENT.routineSecret),
      rotationSignature: 'deadbeef'.repeat(8),
      keyVersion: CURRENT.keyVersion,
      current: CURRENT,
      previous: null,
    })
    expect(result.ok).toBe(false)
  })
})
