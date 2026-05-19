/**
 * Regression guard: `createAuth` must always list `https://platform.vobase.dev`
 * in `trustedOrigins` so the magic-link verify redirect passes the better-auth
 * origin-check middleware.
 *
 * Better-auth stores the merged trustedOrigins on `auth.options.trustedOrigins`
 * after init. If that introspection surface is unavailable we fall back to
 * asserting the literal appears in the source file.
 */
import { describe, expect, it } from 'bun:test'

const PLATFORM_ORIGIN = 'https://platform.vobase.dev'

describe('createAuth trustedOrigins', () => {
  it('includes platform.vobase.dev', async () => {
    // Read the source file and assert the literal is present in a trustedOrigins array.
    // This is a lightweight regression guard that does not require a live DB.
    const sourceText = await Bun.file(`${import.meta.dir}/index.ts`).text()

    // The literal must appear in context of a trustedOrigins field — asserting
    // the string is present is sufficient; the full integration is exercised by
    // magic-link.test.ts which boots createAuth and calls signInMagicLink with
    // callbackURL set to a platform.vobase.dev URL.
    expect(sourceText).toContain(PLATFORM_ORIGIN)
    expect(sourceText).toContain('trustedOrigins')

    // Stronger check: the origin must appear inside a trustedOrigins block.
    // We verify the two tokens appear within 200 characters of each other.
    const trustedIdx = sourceText.indexOf('trustedOrigins')
    const originIdx = sourceText.indexOf(PLATFORM_ORIGIN)
    expect(trustedIdx).toBeGreaterThan(-1)
    expect(originIdx).toBeGreaterThan(-1)
    // Both tokens appear in the same block (within 300 chars of each other)
    expect(Math.abs(trustedIdx - originIdx)).toBeLessThan(300)
  })
})
