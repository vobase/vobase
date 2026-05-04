/**
 * CSRF nonce store for the WhatsApp Embedded Signup flow.
 *
 * `mintNonce` issues a single-use, 5-minute nonce bound to
 * `(organizationId, sessionId)` from the better-auth session cookie. The
 * frontend POSTs the nonce to `/exchange` together with the FB.login result;
 * the backend consumes it atomically with `DELETE … RETURNING`, so a
 * successful exchange and a failed exchange BOTH consume the nonce
 * (replay-safe).
 *
 * The nonce does NOT round-trip through Meta — the JS SDK postMessage flow
 * for ESU does not echo `state`. The nonce binds the server-side flow to
 * the same browser session that called `/start`.
 *
 * Single-writer for `channels.signup_nonces`.
 */
import { signupNonces } from '@modules/channels/schema'
import { lt, sql } from 'drizzle-orm'
import { customAlphabet } from 'nanoid'

import type { ScopedDb } from '~/runtime'

const NONCE_ALPHABET = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789'
const generateNonce = customAlphabet(NONCE_ALPHABET, 32)

const NONCE_TTL_MS = 5 * 60 * 1000

export interface MintNonceInput {
  organizationId: string
  sessionId: string
}

export interface MintNonceResult {
  nonce: string
  expiresAt: Date
}

export interface ConsumeNonceInput {
  nonce: string
  organizationId: string
  sessionId: string
}

export interface SignupNoncesService {
  mintNonce(input: MintNonceInput): Promise<MintNonceResult>
  consumeNonce(input: ConsumeNonceInput): Promise<boolean>
  pruneExpired(now?: Date): Promise<number>
}

export function createSignupNoncesService(deps: { db: ScopedDb }): SignupNoncesService {
  const { db } = deps

  async function mintNonce(input: MintNonceInput): Promise<MintNonceResult> {
    const expiresAt = new Date(Date.now() + NONCE_TTL_MS)
    const nonce = generateNonce()
    await db.insert(signupNonces).values({
      nonce,
      organizationId: input.organizationId,
      sessionId: input.sessionId,
      expiresAt,
    })
    return { nonce, expiresAt }
  }

  async function consumeNonce(input: ConsumeNonceInput): Promise<boolean> {
    // Single-statement DELETE … RETURNING — atomic in Postgres, no
    // read-modify-write race possible. Inline expiry check rejects an
    // expired row even before the prune job runs.
    const result = await db.execute(sql`
      DELETE FROM "channels"."signup_nonces"
      WHERE nonce = ${input.nonce}
        AND organization_id = ${input.organizationId}
        AND session_id = ${input.sessionId}
        AND expires_at > now()
      RETURNING nonce
    `)
    const rows = (result as { rows?: unknown[] }).rows ?? (result as unknown as unknown[])
    return rows.length > 0
  }

  async function pruneExpired(now: Date = new Date()): Promise<number> {
    const rows = await db
      .delete(signupNonces)
      .where(lt(signupNonces.expiresAt, now))
      .returning({ nonce: signupNonces.nonce })
    return rows.length
  }

  return { mintNonce, consumeNonce, pruneExpired }
}

let _current: SignupNoncesService | null = null

export function installSignupNoncesService(svc: SignupNoncesService): void {
  _current = svc
}

export function __resetSignupNoncesServiceForTests(): void {
  _current = null
}

function current(): SignupNoncesService {
  if (!_current) {
    throw new Error('channels/signup-nonces: service not installed — call installSignupNoncesService()')
  }
  return _current
}

export function mintNonce(input: MintNonceInput): Promise<MintNonceResult> {
  return current().mintNonce(input)
}

export function consumeNonce(input: ConsumeNonceInput): Promise<boolean> {
  return current().consumeNonce(input)
}

export function pruneExpiredNonces(now?: Date): Promise<number> {
  return current().pruneExpired(now)
}
