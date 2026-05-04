/**
 * Unit tests for the managed-mode WhatsApp transport.
 *
 * Verifies:
 *   - Outbound `signRequest(method, path)` returns the 2-key headers.
 *   - The payload signed is `${METHOD}${path}` (matches platform contract).
 *   - `verifyInboundManagedWebhook` accepts current key, accepts previous
 *     during grace, rejects downgrade past current.
 */

import { describe, expect, test } from 'bun:test'
import { signHmac } from '@vobase/core'

import { createManagedTransport, verifyInboundManagedWebhook } from './managed-transport'

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

  test('signRequest returns 2-key headers + tenant id', () => {
    const t = createManagedTransport({
      platformChannelId: 'pc-1',
      platformBaseUrl: 'https://platform.voltade.app',
      tenantId: 't-acme',
      current: CURRENT,
      previous: null,
    })
    const headers = t.signRequest('POST', '/api/managed-whatsapp/pc-1/graph/12345/messages')
    expect(headers['X-Tenant-Id']).toBe('t-acme')
    expect(headers['X-Vobase-Key-Version']).toBe('5')

    const expectedPayload = 'POST/api/managed-whatsapp/pc-1/graph/12345/messages'
    expect(headers['X-Vobase-Routine-Sig']).toBe(signHmac(expectedPayload, CURRENT.routineSecret))
    expect(headers['X-Vobase-Rotation-Sig']).toBe(signHmac(expectedPayload, CURRENT.rotationKey))
    // Legacy single-key header for v1 platforms.
    expect(headers['X-Platform-Signature']).toBe(headers['X-Vobase-Routine-Sig'])
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

describe('createManagedTransport.verifyInboundWebhook (wiring into adapter)', () => {
  function buildRequest(body: string, headers: Record<string, string> = {}): Request {
    return new Request('https://tenant.example/api/channels/webhook/whatsapp/inst-1', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', ...headers },
      body,
    })
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
    const ok = await t.verifyInboundWebhook?.(
      buildRequest(body, {
        'X-Vobase-Routine-Sig': signHmac(body, CURRENT.routineSecret),
        'X-Vobase-Rotation-Sig': signHmac(body, CURRENT.rotationKey),
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
        'X-Vobase-Routine-Sig': signHmac(body, CURRENT.routineSecret),
        'X-Vobase-Rotation-Sig': 'deadbeef'.repeat(8),
        'X-Vobase-Key-Version': String(CURRENT.keyVersion),
      }),
    )
    expect(ok).toBe(false)
  })

  test('falls back to v1 legacy header when v2 headers absent', async () => {
    const t = createManagedTransport({
      platformChannelId: 'pc-1',
      platformBaseUrl: 'https://platform.voltade.app',
      tenantId: 't-1',
      current: CURRENT,
      previous: null,
    })
    const body = '{"hello":"v1"}'
    const ok = await t.verifyInboundWebhook?.(
      buildRequest(body, { 'X-Platform-Signature': signHmac(body, CURRENT.routineSecret) }),
    )
    expect(ok).toBe(true)
  })

  test('rejects v1 with wrong secret', async () => {
    const t = createManagedTransport({
      platformChannelId: 'pc-1',
      platformBaseUrl: 'https://platform.voltade.app',
      tenantId: 't-1',
      current: CURRENT,
      previous: null,
    })
    const body = '{"hello":"v1"}'
    const ok = await t.verifyInboundWebhook?.(
      buildRequest(body, { 'X-Platform-Signature': signHmac(body, 'wrong-secret') }),
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

  test('v1 fallback honors previous pair during grace window', async () => {
    const t = createManagedTransport({
      platformChannelId: 'pc-1',
      platformBaseUrl: 'https://platform.voltade.app',
      tenantId: 't-1',
      current: CURRENT,
      previous: PREVIOUS,
    })
    const body = '{"old":"v1"}'
    const ok = await t.verifyInboundWebhook?.(
      buildRequest(body, { 'X-Platform-Signature': signHmac(body, PREVIOUS.routineSecret) }),
    )
    expect(ok).toBe(true)
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
    const ok = await t.verifyInboundWebhook?.(
      buildRequest(body, {
        'X-Vobase-Routine-Sig': signHmac(body, 'fresh-routine'),
        'X-Vobase-Rotation-Sig': signHmac(body, 'fresh-rotation'),
        'X-Vobase-Key-Version': '99',
      }),
    )
    expect(ok).toBe(true)
  })
})

describe('verifyInboundManagedWebhook', () => {
  test('accepts current-key signed payload', () => {
    const body = '{"hello":"world"}'
    const result = verifyInboundManagedWebhook({
      rawBody: body,
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
      rawBody: body,
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
      rawBody: body,
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
      rawBody: body,
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
      rawBody: body,
      routineSignature: signHmac(body, CURRENT.routineSecret),
      rotationSignature: 'deadbeef'.repeat(8),
      keyVersion: CURRENT.keyVersion,
      current: CURRENT,
      previous: null,
    })
    expect(result.ok).toBe(false)
  })
})
