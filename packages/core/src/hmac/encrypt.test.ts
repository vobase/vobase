import { afterEach, beforeAll, describe, expect, test } from 'bun:test'

import {
  __resetEnvelopeCachesForTests,
  CURRENT_KEK_VERSION,
  decryptSecretEnvelope,
  EnvelopeTamperError,
  EnvelopeVersionError,
  encryptSecretEnvelope,
  type SecretEnvelope,
} from './encrypt'

const TEST_SECRET = 'test-better-auth-secret-32-chars-long-yes!'

beforeAll(() => {
  process.env.BETTER_AUTH_SECRET = TEST_SECRET
})

afterEach(() => {
  __resetEnvelopeCachesForTests()
  process.env.BETTER_AUTH_SECRET = TEST_SECRET
})

describe('encryptSecretEnvelope / decryptSecretEnvelope', () => {
  test('round-trips a small payload', () => {
    const envelope = encryptSecretEnvelope('hello, vault')
    expect(envelope.kekVersion).toBe(CURRENT_KEK_VERSION)
    expect(envelope.iv.length).toBe(12)
    expect(envelope.tag.length).toBe(16)
    expect(envelope.dekCiphertext.length).toBeGreaterThanOrEqual(32 + 16)
    expect(envelope.payloadCiphertext.length).toBe('hello, vault'.length)

    const decrypted = decryptSecretEnvelope(envelope)
    expect(decrypted).toBe('hello, vault')
  })

  test('round-trips multi-line UTF-8 payload', () => {
    const plaintext = '🔐 line one\nLINE TWO with === / + symbols\n日本語\n'
    const envelope = encryptSecretEnvelope(plaintext)
    expect(decryptSecretEnvelope(envelope)).toBe(plaintext)
  })

  test('two encryptions of the same plaintext produce different ciphertexts', () => {
    const a = encryptSecretEnvelope('same')
    const b = encryptSecretEnvelope('same')
    expect(a.iv.equals(b.iv)).toBe(false)
    expect(a.payloadCiphertext.equals(b.payloadCiphertext)).toBe(false)
    expect(a.dekCiphertext.equals(b.dekCiphertext)).toBe(false)
    expect(decryptSecretEnvelope(a)).toBe('same')
    expect(decryptSecretEnvelope(b)).toBe('same')
  })

  test('tamper detection — flipped payload byte', () => {
    const envelope = encryptSecretEnvelope('payment-token-xyz')
    const tampered: SecretEnvelope = {
      ...envelope,
      payloadCiphertext: Buffer.from(envelope.payloadCiphertext),
    }
    tampered.payloadCiphertext[0] ^= 0x01
    expect(() => decryptSecretEnvelope(tampered)).toThrow(EnvelopeTamperError)
  })

  test('tamper detection — flipped IV byte', () => {
    const envelope = encryptSecretEnvelope('payment-token-xyz')
    const tampered: SecretEnvelope = { ...envelope, iv: Buffer.from(envelope.iv) }
    tampered.iv[0] ^= 0xff
    expect(() => decryptSecretEnvelope(tampered)).toThrow(EnvelopeTamperError)
  })

  test('tamper detection — flipped GCM tag', () => {
    const envelope = encryptSecretEnvelope('payment-token-xyz')
    const tampered: SecretEnvelope = { ...envelope, tag: Buffer.from(envelope.tag) }
    tampered.tag[0] ^= 0x10
    expect(() => decryptSecretEnvelope(tampered)).toThrow(EnvelopeTamperError)
  })

  test('tamper detection — corrupted wrapped DEK', () => {
    const envelope = encryptSecretEnvelope('payment-token-xyz')
    const tampered: SecretEnvelope = {
      ...envelope,
      dekCiphertext: Buffer.from(envelope.dekCiphertext),
    }
    tampered.dekCiphertext[0] ^= 0xaa
    expect(() => decryptSecretEnvelope(tampered)).toThrow(EnvelopeTamperError)
  })

  test('tamper detection — truncated DEK ciphertext', () => {
    const envelope = encryptSecretEnvelope('payment-token-xyz')
    const tampered: SecretEnvelope = {
      ...envelope,
      dekCiphertext: envelope.dekCiphertext.subarray(0, 8),
    }
    expect(() => decryptSecretEnvelope(tampered)).toThrow(EnvelopeTamperError)
  })

  test('version mismatch — unknown KEK version rejected', () => {
    const envelope = encryptSecretEnvelope('payment-token-xyz')
    const tampered: SecretEnvelope = { ...envelope, kekVersion: 99 }
    expect(() => decryptSecretEnvelope(tampered)).toThrow(EnvelopeVersionError)
  })

  test('rotating BETTER_AUTH_SECRET breaks decryption (intended)', () => {
    const envelope = encryptSecretEnvelope('vault-row')
    expect(decryptSecretEnvelope(envelope)).toBe('vault-row')
    process.env.BETTER_AUTH_SECRET = 'a-different-secret-also-32-chars-long!!'
    __resetEnvelopeCachesForTests()
    expect(() => decryptSecretEnvelope(envelope)).toThrow(EnvelopeTamperError)
  })

  test('refuses to derive a KEK from a missing/weak secret', () => {
    process.env.BETTER_AUTH_SECRET = ''
    __resetEnvelopeCachesForTests()
    expect(() => encryptSecretEnvelope('x')).toThrow(/BETTER_AUTH_SECRET/)
    process.env.BETTER_AUTH_SECRET = 'too-short'
    __resetEnvelopeCachesForTests()
    expect(() => encryptSecretEnvelope('x')).toThrow(/BETTER_AUTH_SECRET/)
  })
})
