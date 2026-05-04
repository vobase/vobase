import { timingSafeEqual } from 'node:crypto'
import { Hono } from 'hono'

import type { VobaseDb } from '../db/client'
import type { Scheduler } from '../jobs/queue'
import { webhookDedup } from '../schemas/webhook-dedup'

export { webhookDedup } from '../schemas/webhook-dedup'

export interface WebhookConfig {
  /** Route path, e.g. '/webhooks/stripe' */
  path: string
  /** HMAC secret for signature verification */
  secret: string
  /** Job name to enqueue, e.g. 'system:processWebhook' */
  handler: string
  /** Header containing the signature (default: 'x-webhook-signature') */
  signatureHeader?: string
  /** Whether to deduplicate webhooks (default: true) */
  dedup?: boolean
  /** Header containing the webhook delivery ID (default: 'x-webhook-id') */
  idHeader?: string
}

/**
 * Verify an HMAC-SHA256 signature against a payload and secret.
 *
 * Uses timing-safe comparison to prevent timing attacks.
 * Returns false for any malformed or invalid signature (never throws).
 */
export function verifyHmacSignature(payload: string, signature: string, secret: string): boolean {
  try {
    const expected = new Bun.CryptoHasher('sha256', secret).update(payload).digest('hex')

    if (signature.length !== expected.length) {
      return false
    }

    const sigBuffer = Buffer.from(signature, 'hex')
    const expectedBuffer = Buffer.from(expected, 'hex')

    // If the hex decode produced different lengths (malformed hex), reject
    if (sigBuffer.length !== expectedBuffer.length) {
      return false
    }

    return timingSafeEqual(sigBuffer, expectedBuffer)
  } catch {
    return false
  }
}

/** Sign a payload with HMAC-SHA256. Symmetric to verifyHmacSignature. */
export function signHmac(payload: string, secret: string): string {
  return new Bun.CryptoHasher('sha256', secret).update(payload).digest('hex')
}

// ─── Two-key rotating HMAC (managed-channel rotation contract) ──────────────
//
// Managed channels (vobase-platform → template) sign requests with TWO keys:
//
//   1. `routineSecret` — long-lived per-instance secret. Stable identity.
//   2. `rotationKey`   — short-lived rolling key, bumped via `keyVersion`.
//
// The verifier accepts a slate of `(secret, keyVersion)` pairs (typically
// "current" and "previous" so a rotation in flight isn't a hard cutover) and
// requires the inbound `keyVersion` to be strictly monotonic — a request
// signed with version N is rejected once we've seen N+1, even if its
// signature is otherwise valid. This kills replay-with-downgrade where an
// attacker captures an old request and replays it after rotation.
//
// Wire format the platform uses:
//
//   x-vobase-routine-sig:  hex(HMAC-SHA256(routineSecret, body))
//   x-vobase-rotation-sig: hex(HMAC-SHA256(rotationKey, body))
//   x-vobase-key-version:  decimal integer (monotonic per channel instance)
//
// Both signatures must verify against any element of the `accept` slate that
// also matches `keyVersion`. The caller persists `maxKeyVersionSeen` per
// channel instance and refreshes it whenever it advances.

export interface SignRequestInput {
  body: string
  routineSecret: string
  rotationKey: string
  keyVersion: number
}

export interface SignedRequest {
  routineSignature: string
  rotationSignature: string
  keyVersion: number
}

/** Sign a request payload with both keys. The platform side calls this per outgoing request. */
export function signRequest(input: SignRequestInput): SignedRequest {
  return {
    routineSignature: signHmac(input.body, input.routineSecret),
    rotationSignature: signHmac(input.body, input.rotationKey),
    keyVersion: input.keyVersion,
  }
}

export interface VerifyRequestInput {
  body: string
  routineSignature: string
  rotationSignature: string
  /** `keyVersion` advertised by the inbound request. */
  keyVersion: number
  /**
   * Highest `keyVersion` previously seen for this channel instance. Inbound
   * `keyVersion` strictly less than this is rejected (downgrade defense).
   * Use 0 on first-ever verification.
   */
  maxKeyVersionSeen: number
  /**
   * Acceptable `(secret, keyVersion)` slate. Typically the "current" pair
   * plus an optional "previous" pair so a rotation in flight isn't a hard
   * cutover. The slate must include an entry whose `keyVersion` matches
   * the inbound `keyVersion`.
   */
  accept: ReadonlyArray<{ routineSecret: string; rotationKey: string; keyVersion: number }>
}

export type VerifyRequestResult =
  | { ok: true; nextMaxKeyVersionSeen: number }
  | { ok: false; reason: 'downgrade' | 'unknown_version' | 'bad_routine_sig' | 'bad_rotation_sig' | 'malformed' }

/**
 * Verify a 2-key signed request. Both signatures must match an `accept`
 * entry whose `keyVersion` equals the inbound `keyVersion`, and the inbound
 * `keyVersion` must be `>= maxKeyVersionSeen` (strict equality is allowed
 * — same-version retries are normal; downgrades are not).
 */
export function verifyRequest(input: VerifyRequestInput): VerifyRequestResult {
  if (!Number.isInteger(input.keyVersion) || input.keyVersion < 0) {
    return { ok: false, reason: 'malformed' }
  }
  if (input.keyVersion < input.maxKeyVersionSeen) {
    return { ok: false, reason: 'downgrade' }
  }
  const slot = input.accept.find((s) => s.keyVersion === input.keyVersion)
  if (!slot) {
    return { ok: false, reason: 'unknown_version' }
  }
  if (!verifyHmacSignature(input.body, input.routineSignature, slot.routineSecret)) {
    return { ok: false, reason: 'bad_routine_sig' }
  }
  if (!verifyHmacSignature(input.body, input.rotationSignature, slot.rotationKey)) {
    return { ok: false, reason: 'bad_rotation_sig' }
  }
  return {
    ok: true,
    nextMaxKeyVersionSeen: Math.max(input.maxKeyVersionSeen, input.keyVersion),
  }
}

// ─── Envelope encryption re-export ─────────────────────────────────────────

export {
  __resetEnvelopeCachesForTests,
  CURRENT_KEK_VERSION,
  decryptSecretEnvelope,
  EnvelopeTamperError,
  EnvelopeVersionError,
  encryptSecretEnvelope,
  type SecretEnvelope,
} from './encrypt'

/**
 * Record a webhook and report whether it is a duplicate. Single round-trip
 * upsert — the conflict branch returns zero rows, which atomically classifies
 * the arrival as a duplicate without a separate SELECT (closing the TOCTOU
 * window between two concurrent identical deliveries).
 *
 * @returns `true` if the webhook is a duplicate, `false` if it's new.
 */
export async function checkAndRecordWebhook(db: VobaseDb, webhookId: string, source: string): Promise<boolean> {
  const inserted = await db
    .insert(webhookDedup)
    .values({ id: webhookId, source, receivedAt: new Date() })
    .onConflictDoNothing()
    .returning({ id: webhookDedup.id })

  return inserted.length === 0
}

/**
 * Create a Hono router that handles incoming webhook POST requests.
 *
 * For each webhook config, registers a POST handler that:
 * 1. Verifies HMAC signature
 * 2. Optionally deduplicates by webhook ID
 * 3. Enqueues the payload to the configured job
 */
export function createWebhookRoutes(
  configs: Record<string, WebhookConfig>,
  deps: { db: VobaseDb; scheduler: Scheduler },
): Hono {
  const { db, scheduler } = deps

  const router = new Hono()

  for (const [source, config] of Object.entries(configs)) {
    router.post(config.path, async (c) => {
      const body = await c.req.text()

      const sigHeader = config.signatureHeader ?? 'x-webhook-signature'
      const signature = c.req.header(sigHeader) ?? ''

      if (!verifyHmacSignature(body, signature, config.secret)) {
        return c.json({ error: 'Invalid signature' }, 401)
      }

      const dedupEnabled = config.dedup !== false

      if (dedupEnabled) {
        const idHeader = config.idHeader ?? 'x-webhook-id'
        const webhookId = c.req.header(idHeader) ?? ''

        if (webhookId && (await checkAndRecordWebhook(db, webhookId, source))) {
          return c.json({ received: true, deduplicated: true }, 200)
        }
      }

      let payload: unknown
      try {
        payload = JSON.parse(body)
      } catch {
        payload = body
      }

      await scheduler.add(config.handler, {
        source,
        webhookId: c.req.header(config.idHeader ?? 'x-webhook-id') ?? '',
        payload,
      })

      return c.json({ received: true }, 200)
    })
  }

  return router
}
