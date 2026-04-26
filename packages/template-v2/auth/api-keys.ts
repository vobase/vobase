/**
 * API key service — backs `Authorization: Bearer vbt_<random>` for the
 * external CLI binary and any other long-lived programmatic principal.
 *
 * Why we own this instead of better-auth's apikey plugin: better-auth 1.6.9
 * ships the `authApikey` table schema but no runtime plugin. We don't need
 * the plugin's full feature set (rate limits, refills, permissions, expiry)
 * yet — just `create + verify + list + revoke` against the existing table.
 * If we later need rate-limits or scoped permissions, swap this file for the
 * plugin without touching call sites.
 *
 * Token format: `vbt_<24-char-random>` — 32 chars total, ~144 bits entropy.
 * Storage: sha256 hash in `key`, plaintext prefix `vbt_` in `prefix`, first
 * 4 chars of the random tail in `start` for display. Plaintext token is
 * returned ONCE at creation time and never persisted.
 */

import { authApikey, authMember, authUser } from '@vobase/core'
import { and, desc, eq } from 'drizzle-orm'

import type { ScopedDb } from '~/runtime'

const TOKEN_PREFIX = 'vbt_'
const TOKEN_LENGTH = 24

/** Public shape returned by `listApiKeys`. The plaintext key is never re-shown. */
export interface ApiKeySummary {
  id: string
  name: string | null
  prefix: string
  start: string | null
  enabled: boolean
  lastRequest: Date | null
  createdAt: Date
}

export interface CreatedApiKey extends ApiKeySummary {
  /** Plaintext token, shown once at creation. */
  key: string
}

export interface VerifyResult {
  ok: boolean
  /** Owning user id (better-auth `referenceId`). */
  userId?: string
  /** API key row id (for `last_request` updates and revocation). */
  keyId?: string
}

/** Generate a fresh `vbt_<24>` token. URL-safe alphabet, no padding. */
export function generateToken(): string {
  // 18 bytes → 24 base64url chars. Bun.randomUUIDv7 gives us 16 bytes;
  // we'd rather use crypto.getRandomValues directly.
  const bytes = new Uint8Array(18)
  crypto.getRandomValues(bytes)
  let out = ''
  for (let i = 0; i + 3 <= bytes.length; i += 3) {
    const a = bytes[i]
    const b = bytes[i + 1]
    const c = bytes[i + 2]
    out += B64URL[a >> 2]
    out += B64URL[((a & 0b11) << 4) | (b >> 4)]
    out += B64URL[((b & 0b1111) << 2) | (c >> 6)]
    out += B64URL[c & 0b111111]
  }
  return TOKEN_PREFIX + out.slice(0, TOKEN_LENGTH)
}

const B64URL = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789-_'

/** sha256(token) hex. Stable hash for indexing. */
export function hashToken(token: string): string {
  const hasher = new Bun.CryptoHasher('sha256')
  hasher.update(token)
  return hasher.digest('hex')
}

export interface CreateApiKeyOpts {
  db: ScopedDb
  userId: string
  name?: string
}

export async function createApiKey(opts: CreateApiKeyOpts): Promise<CreatedApiKey> {
  const token = generateToken()
  const tail = token.slice(TOKEN_PREFIX.length)
  const id = `apk_${tail.slice(0, 16)}`
  const now = new Date()
  // biome-ignore lint/suspicious/noExplicitAny: drizzle scoped-db typing
  const dbAny = opts.db as any
  await dbAny.insert(authApikey).values({
    id,
    name: opts.name ?? null,
    referenceId: opts.userId,
    prefix: TOKEN_PREFIX,
    start: tail.slice(0, 4),
    key: hashToken(token),
    enabled: true,
    requestCount: 0,
    rateLimitEnabled: false,
    createdAt: now,
    updatedAt: now,
  })
  return {
    id,
    name: opts.name ?? null,
    prefix: TOKEN_PREFIX,
    start: tail.slice(0, 4),
    enabled: true,
    lastRequest: null,
    createdAt: now,
    key: token,
  }
}

export interface VerifyOpts {
  db: ScopedDb
  token: string
  /** Update `lastRequest` + `requestCount` on a successful match. Default true. */
  touch?: boolean
}

export async function verifyApiKey({ db, token, touch = true }: VerifyOpts): Promise<VerifyResult> {
  if (!token.startsWith(TOKEN_PREFIX)) return { ok: false }
  const hash = hashToken(token)
  // biome-ignore lint/suspicious/noExplicitAny: drizzle scoped-db typing
  const dbAny = db as any
  const [row] = await dbAny
    .select({ id: authApikey.id, referenceId: authApikey.referenceId, enabled: authApikey.enabled })
    .from(authApikey)
    .where(eq(authApikey.key, hash))
    .limit(1)
  if (!row?.enabled) return { ok: false }
  if (touch) {
    await dbAny.update(authApikey).set({ lastRequest: new Date() }).where(eq(authApikey.id, row.id))
  }
  return { ok: true, userId: row.referenceId, keyId: row.id }
}

export async function listApiKeys(db: ScopedDb, userId: string): Promise<ApiKeySummary[]> {
  // biome-ignore lint/suspicious/noExplicitAny: drizzle scoped-db typing
  const dbAny = db as any
  const rows = await dbAny
    .select({
      id: authApikey.id,
      name: authApikey.name,
      prefix: authApikey.prefix,
      start: authApikey.start,
      enabled: authApikey.enabled,
      lastRequest: authApikey.lastRequest,
      createdAt: authApikey.createdAt,
    })
    .from(authApikey)
    .where(eq(authApikey.referenceId, userId))
    .orderBy(desc(authApikey.createdAt))
  return rows as ApiKeySummary[]
}

export async function revokeApiKey(db: ScopedDb, userId: string, keyId: string): Promise<boolean> {
  // biome-ignore lint/suspicious/noExplicitAny: drizzle scoped-db typing
  const dbAny = db as any
  const res = await dbAny
    .update(authApikey)
    .set({ enabled: false, updatedAt: new Date() })
    .where(and(eq(authApikey.id, keyId), eq(authApikey.referenceId, userId)))
    .returning({ id: authApikey.id })
  return res.length > 0
}

/**
 * Resolve an authenticated principal from a verified API key. Looks up the
 * user's active membership (single-org default) to populate
 * `{ userId, organizationId, role, email }`.
 */
export interface ApiKeyPrincipal {
  userId: string
  organizationId: string
  role: string
  email: string
}

export async function resolveApiKeyPrincipal(db: ScopedDb, userId: string): Promise<ApiKeyPrincipal | null> {
  // biome-ignore lint/suspicious/noExplicitAny: drizzle scoped-db typing
  const dbAny = db as any
  const [row] = await dbAny
    .select({
      userId: authUser.id,
      email: authUser.email,
      organizationId: authMember.organizationId,
      role: authMember.role,
    })
    .from(authUser)
    .innerJoin(authMember, eq(authMember.userId, authUser.id))
    .where(eq(authUser.id, userId))
    .limit(1)
  if (!row) return null
  return {
    userId: row.userId,
    organizationId: row.organizationId,
    role: row.role ?? 'member',
    email: row.email,
  }
}
