import { describe, expect, it } from 'bun:test'
import { signRequest, verifyRequest } from '@vobase/core'

import { sha256Hex, splitPathAndQuery } from '../../channels/adapters/whatsapp/managed-transport'

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
