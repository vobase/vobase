/**
 * Integration tests for auth/magic-link.ts — mintMagicLink + captor.
 *
 * Requires a running Postgres on :5432 (docker compose up -d).
 * Each describe resets and seeds the DB via resetAndSeedDb().
 */
import { afterAll, beforeAll, describe, expect, it } from 'bun:test'

import { connectTestDb, resetAndSeedDb } from '../tests/helpers/test-db'
import { createAuth } from './index'
import { MagicLinkMintError, mintMagicLink } from './magic-link'

// Alice is seeded by contacts/seed.ts — userId + email are stable across resets.
const ALICE_USER_ID = 'usr0alice0'
const ALICE_EMAIL = 'alice@meridian.test'

describe('mintMagicLink', () => {
  const handle = connectTestDb()
  let auth: ReturnType<typeof createAuth>

  beforeAll(async () => {
    await resetAndSeedDb()
    auth = createAuth(handle.db as Parameters<typeof createAuth>[0])
  })

  afterAll(async () => {
    await handle.teardown()
  })

  it('returns a platform URL with correct shape', async () => {
    const result = await mintMagicLink(auth, handle.db, {
      userId: ALICE_USER_ID,
      email: ALICE_EMAIL,
      tenantId: 't1',
      organizationId: 'o1',
      redirectPath: '/inbox/c1/approvals/a1',
    })

    // URL shape: https://platform.voltade.app/auth/magic?tenant=t1&token=...&redirect=%2Finbox%2Fc1%2Fapprovals%2Fa1&organization=o1
    expect(result.url).toMatch(
      /^https:\/\/platform\.voltade\.app\/auth\/magic\?tenant=t1&token=[A-Za-z0-9_%-]+&redirect=%2Finbox%2Fc1%2Fapprovals%2Fa1&organization=o1$/u,
    )
    expect(result.token).toBeTruthy()
    expect(result.token.length).toBeGreaterThan(10)
    // expiresAt should be ~24h from now
    const expiresAt = new Date(result.expiresAt).getTime()
    expect(expiresAt).toBeGreaterThan(Date.now() + 23 * 60 * 60 * 1000)
    expect(expiresAt).toBeLessThan(Date.now() + 25 * 60 * 60 * 1000)
  })

  it('throws MagicLinkMintError wrapping staff_user_not_found for a nonexistent user', async () => {
    // US-011b changed mintMagicLink to wrap all inner errors in MagicLinkMintError
    // (so dispatcher's `instanceof MagicLinkMintError` catch works uniformly).
    // The original `staff_user_not_found` notFound error is preserved as `.cause`.
    try {
      await mintMagicLink(auth, handle.db, {
        userId: 'nonexistent-user-id',
        email: 'nobody@nowhere.test',
        tenantId: 't1',
        organizationId: 'o1',
        redirectPath: '/inbox',
      })
      throw new Error('mintMagicLink should have thrown')
    } catch (err) {
      expect(err).toBeInstanceOf(MagicLinkMintError)
      const mintErr = err as MagicLinkMintError
      expect(mintErr.message).toBe('magic_link_mint_failed')
      // Inner cause carries the original staff_user_not_found shape
      const cause = mintErr.cause as { code?: string; message?: string } | undefined
      const innerText = JSON.stringify(cause ?? {}) + String(cause?.message ?? '')
      expect(innerText).toContain('staff_user_not_found')
    }
  })

  it('resolves 50 concurrent mints for the same email to distinct tokens', async () => {
    const results = await Promise.all(
      Array.from({ length: 50 }, () =>
        mintMagicLink(auth, handle.db, {
          userId: ALICE_USER_ID,
          email: ALICE_EMAIL,
          tenantId: 't1',
          organizationId: 'o1',
          redirectPath: '/inbox',
        }),
      ),
    )
    const tokens = new Set(results.map((r) => r.token))
    expect(tokens.size).toBe(50)
  })

  it('no-captor-nonce-in-url regression: platform URL does not contain __captor_nonce', async () => {
    const result = await mintMagicLink(auth, handle.db, {
      userId: ALICE_USER_ID,
      email: ALICE_EMAIL,
      tenantId: 't1',
      organizationId: 'o1',
      redirectPath: '/inbox',
    })
    expect(result.url).not.toContain('__captor_nonce')

    // Also assert the source file itself never contains the literal string.
    const sourceText = await Bun.file(`${import.meta.dir}/magic-link.ts`).text()
    expect(sourceText).not.toContain('__captor_nonce')
  })
})

describe('mintMagicLink captor timeout', () => {
  // Isolated test: monkey-patch auth.api.signInMagicLink to resolve without
  // ever calling sendMagicLink (simulating a future config change where the
  // callback is skipped). The captor should time out within CAPTOR_TIMEOUT_MS.
  it('rejects with captor_timeout when sendMagicLink is never called', async () => {
    const handle2 = connectTestDb()
    try {
      await resetAndSeedDb()
      const realAuth = createAuth(handle2.db as Parameters<typeof createAuth>[0])

      // Build a stub auth where signInMagicLink resolves silently without
      // invoking sendMagicLink — this triggers the captor timeout.
      const stubAuth = {
        ...realAuth,
        api: {
          ...realAuth.api,
          // biome-ignore lint/suspicious/noExplicitAny: stub for timeout test
          signInMagicLink: async (_opts: unknown) => ({ status: true }) as any,
        },
      } as unknown as typeof realAuth

      const startMs = Date.now()
      // US-011b wraps captor_timeout in MagicLinkMintError; inner cause preserves the original.
      try {
        await mintMagicLink(stubAuth, handle2.db, {
          userId: ALICE_USER_ID,
          email: ALICE_EMAIL,
          tenantId: 't1',
          organizationId: 'o1',
          redirectPath: '/inbox',
        })
        throw new Error('mintMagicLink should have rejected on captor timeout')
      } catch (err) {
        expect(err).toBeInstanceOf(MagicLinkMintError)
        const mintErr = err as MagicLinkMintError
        expect(mintErr.message).toBe('magic_link_mint_failed')
        const causeMsg = (mintErr.cause as { message?: string } | undefined)?.message ?? String(mintErr.cause ?? '')
        expect(causeMsg).toContain('captor_timeout')
      }

      // Should reject within 5.5 s of CAPTOR_TIMEOUT_MS = 5_000
      expect(Date.now() - startMs).toBeLessThan(5_500)
    } finally {
      await handle2.teardown()
    }
  }, 10_000)
})
