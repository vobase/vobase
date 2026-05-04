/**
 * Envelope encryption for at-rest secrets (vault rotation safety).
 *
 * Two-tier key model:
 *
 *   plaintext --[DEK, AES-256-GCM]--> payloadCiphertext
 *   DEK       --[KEK, AES-256-GCM]--> dekCiphertext
 *
 * Each row stores `{ kekVersion, dekCiphertext, payloadCiphertext, iv, tag }`.
 * KEK rotation re-wraps `dekCiphertext` only — `payloadCiphertext` is never
 * touched, so rotating the KEK is O(rows) and bounded by tiny ciphertexts.
 *
 * KEK derivation pins the salt to a versioned constant so rotating
 * `BETTER_AUTH_SECRET` does NOT silently break the vault: vault rotation is
 * an explicit operator step (re-wrap DEKs under the new KEK version), and
 * `BETTER_AUTH_SECRET` rotation is only safe AFTER the re-wrap completes.
 *
 *   KEK_v1 = HKDF-SHA256(BETTER_AUTH_SECRET, salt='vobase-vault-kek-v1', info='kek-v1')
 *   KEK_v2 = HKDF-SHA256(BETTER_AUTH_SECRET, salt='vobase-vault-kek-v2', info='kek-v2')
 *
 * Future versions add a new salt + info pair; the resolver branches on
 * `kekVersion`, so old rows decrypt under their original KEK while new writes
 * use the latest. Re-wrap is out-of-band (operator script).
 *
 * Tamper detection: AES-GCM authenticates ciphertext+IV; the `decrypt*`
 * helpers throw when the tag fails or the version is unknown. Callers should
 * treat any thrown error as "ciphertext compromised — alert ops".
 */
import { createCipheriv, createDecipheriv, hkdfSync, randomBytes } from 'node:crypto'

/** Latest KEK version used for new writes. */
export const CURRENT_KEK_VERSION = 1 as const

const KEK_SALTS = {
  1: 'vobase-vault-kek-v1',
} as const satisfies Record<number, string>

const KEK_INFOS = {
  1: 'kek-v1',
} as const satisfies Record<number, string>

const KEY_BYTES = 32 // AES-256
const IV_BYTES = 12 // GCM standard nonce length
const DEK_TAG_OFFSET = -16 // last 16 bytes of dekCiphertext are the GCM tag

const dekIvCache = new Map<number, Buffer>()
function getKekIv(version: number): Buffer {
  const cached = dekIvCache.get(version)
  if (cached) return cached
  // Deterministic IV per KEK version: the wrapped DEK is unique per row
  // (random 32-byte payload), so a fixed IV per KEK key is GCM-safe — there
  // is no plaintext re-use across rows. Avoiding a per-row IV column for the
  // wrapped DEK keeps the envelope footprint to one IV (for the payload).
  const iv = Buffer.alloc(IV_BYTES, 0)
  iv.writeUInt32BE(version, 0)
  iv.writeUInt32BE(0xdec0ded0, 4)
  iv.writeUInt32BE(0x0badc0de, 8)
  dekIvCache.set(version, iv)
  return iv
}

const kekCache = new Map<number, Buffer>()
function deriveKek(version: number, masterSecret: string): Buffer {
  const cacheKey = version
  const cached = kekCache.get(cacheKey)
  if (cached) return cached
  const salt = KEK_SALTS[version as keyof typeof KEK_SALTS]
  const info = KEK_INFOS[version as keyof typeof KEK_INFOS]
  if (!salt || !info) {
    throw new EnvelopeVersionError(version)
  }
  const derived = hkdfSync(
    'sha256',
    Buffer.from(masterSecret, 'utf8'),
    Buffer.from(salt, 'utf8'),
    Buffer.from(info, 'utf8'),
    KEY_BYTES,
  )
  const kek = Buffer.from(derived)
  kekCache.set(cacheKey, kek)
  return kek
}

function getMasterSecret(): string {
  const secret = process.env.BETTER_AUTH_SECRET
  if (!secret || secret.length < 32) {
    throw new Error(
      'BETTER_AUTH_SECRET must be set (>=32 chars) before encrypting vault payloads. Refusing to derive a KEK from a missing/weak secret.',
    )
  }
  return secret
}

export class EnvelopeVersionError extends Error {
  constructor(public readonly version: number) {
    super(`unknown KEK version ${version} — refuse to decrypt`)
    this.name = 'EnvelopeVersionError'
  }
}

export class EnvelopeTamperError extends Error {
  constructor(message: string) {
    super(`envelope tamper detected: ${message}`)
    this.name = 'EnvelopeTamperError'
  }
}

export interface SecretEnvelope {
  /** KEK version used to wrap the DEK. Pinned per row; rotations re-wrap. */
  kekVersion: number
  /** AES-256-GCM(KEK, randomDek) — includes 16-byte trailing GCM tag. */
  dekCiphertext: Buffer
  /** AES-256-GCM(DEK, plaintext) — does NOT include the tag (see `tag`). */
  payloadCiphertext: Buffer
  /** 12-byte GCM nonce for `payloadCiphertext`. Random per encryption. */
  iv: Buffer
  /** 16-byte GCM auth tag for `payloadCiphertext`. */
  tag: Buffer
}

/**
 * Encrypt `plaintext` under a fresh DEK; wrap the DEK under the current KEK.
 * Returns the four ciphertext fields the caller persists alongside
 * `kekVersion`. Re-encrypting the same plaintext yields different ciphertext
 * because the DEK and IV are random.
 */
export function encryptSecretEnvelope(plaintext: string): SecretEnvelope {
  const dek = randomBytes(KEY_BYTES)
  const iv = randomBytes(IV_BYTES)
  const cipher = createCipheriv('aes-256-gcm', dek, iv)
  const payloadCiphertext = Buffer.concat([cipher.update(plaintext, 'utf8'), cipher.final()])
  const tag = cipher.getAuthTag()

  const kek = deriveKek(CURRENT_KEK_VERSION, getMasterSecret())
  const dekIv = getKekIv(CURRENT_KEK_VERSION)
  const dekCipher = createCipheriv('aes-256-gcm', kek, dekIv)
  const wrappedDek = Buffer.concat([dekCipher.update(dek), dekCipher.final()])
  const dekTag = dekCipher.getAuthTag()

  return {
    kekVersion: CURRENT_KEK_VERSION,
    dekCiphertext: Buffer.concat([wrappedDek, dekTag]),
    payloadCiphertext,
    iv,
    tag,
  }
}

/**
 * Decrypt a previously persisted envelope. Throws `EnvelopeVersionError` if
 * `kekVersion` is unknown to the running build, or `EnvelopeTamperError` if
 * either GCM tag fails to verify (ciphertext, IV, or wrapped-DEK tampered).
 */
export function decryptSecretEnvelope(envelope: SecretEnvelope): string {
  const { kekVersion, dekCiphertext, payloadCiphertext, iv, tag } = envelope
  const kek = deriveKek(kekVersion, getMasterSecret())
  const dekIv = getKekIv(kekVersion)

  if (dekCiphertext.length < 16) {
    throw new EnvelopeTamperError('dekCiphertext shorter than GCM tag')
  }
  const wrappedDek = dekCiphertext.subarray(0, DEK_TAG_OFFSET)
  const dekTag = dekCiphertext.subarray(DEK_TAG_OFFSET)

  let dek: Buffer
  try {
    const dekDecipher = createDecipheriv('aes-256-gcm', kek, dekIv)
    dekDecipher.setAuthTag(dekTag)
    dek = Buffer.concat([dekDecipher.update(wrappedDek), dekDecipher.final()])
  } catch (err) {
    throw new EnvelopeTamperError(`wrapped-DEK verification failed: ${(err as Error).message}`)
  }

  try {
    const decipher = createDecipheriv('aes-256-gcm', dek, iv)
    decipher.setAuthTag(tag)
    const plaintext = Buffer.concat([decipher.update(payloadCiphertext), decipher.final()])
    return plaintext.toString('utf8')
  } catch (err) {
    throw new EnvelopeTamperError(`payload verification failed: ${(err as Error).message}`)
  }
}

/**
 * Test-only: clear cached KEKs so a different `BETTER_AUTH_SECRET` takes
 * effect mid-process. Production code never needs this.
 */
export function __resetEnvelopeCachesForTests(): void {
  kekCache.clear()
  dekIvCache.clear()
}
