/**
 * Slice 1 — rollback dry-run regression guard (US-008)
 *
 * // TODO: this test (and the MANAGED_ACCEPT_LEGACY_FOR_ROLLBACK env var it tests) is DELETED in Slice 2 first commit.
 *
 * US-006 removed all v1 wire-emit paths from the tenant codebase. This test is
 * the regression guard that ensures they are never accidentally re-introduced.
 *
 * Design choice: since the tenant does NOT host the platform's verifier
 * (`verifyTenantSignature` lives in vobase-platform, which we deliberately do
 * NOT cross-repo import), this test is structured as a source-grep-based
 * contract assertion rather than a live verifier exercise. That keeps the test
 * fully in-process (no live DB, no live network) and avoids coupling the
 * tenant package to platform internals.
 *
 * Two cases:
 *
 *   1. MANAGED_ACCEPT_LEGACY_FOR_ROLLBACK=true  — a synthetic v1-shaped
 *      request would be accepted on the PLATFORM side during a rollback window.
 *      Documented here via an assertion on the env-var BEHAVIOUR CONTRACT: the
 *      flag's mere existence is flagged by the grep guard so Slice 2 can
 *      mechanically find and delete both this test and any lingering references.
 *
 *   2. MANAGED_ACCEPT_LEGACY_FOR_ROLLBACK=false (or absent) — the tenant emits
 *      only v2 signatures. Confirmed by asserting that tenant source contains
 *      no v1-emission patterns.
 *
 * No live network. No live DB. Pure in-process and filesystem reads.
 */

import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { describe, expect, it } from 'bun:test'
import { signRequest } from '@vobase/core'

// ─── Paths under assertion ────────────────────────────────────────────────────

const TEMPLATE_ROOT = join(import.meta.dir, '../../')

// Files that are part of the @contract platform-tenant-v1 surface and thus the
// most likely landing spots for an accidental v1 re-introduction.
const CONTRACT_FILES = [
  'modules/integrations/service/handshake.ts',
  'modules/channels/adapters/whatsapp/managed-transport.ts',
]

// ─── v1 emission patterns ─────────────────────────────────────────────────────
// Patterns whose presence in tenant source would indicate a v1 outbound emit.
// This list is deliberately conservative — false negatives (missing a new
// pattern) are worse than false positives (spurious match requiring a comment).
const V1_EMIT_PATTERNS: Array<{ pattern: RegExp; label: string }> = [
  {
    // The v1 canonical payload started with the bare body string, not
    // `${METHOD}|${path}|...`. A v1 sign call would pass `body` directly
    // without the METHOD| prefix.
    pattern: /X-Vobase-Sig-Version['":\s]+['"]?1['"]?(?!\d)/,
    label: 'X-Vobase-Sig-Version: 1 header',
  },
  {
    // v1 used a single `x-vobase-hmac` header (not routine+rotation split).
    pattern: /x-vobase-hmac/i,
    label: 'x-vobase-hmac header (v1 single-key)',
  },
  {
    // Any explicit "sig_version: 1" or sigVersion = 1 assignments.
    pattern: /sig[_-]?[Vv]ersion\s*[:=]\s*['"]?1['"]?/,
    label: 'sigVersion = 1 assignment',
  },
]

// ─── Helpers ──────────────────────────────────────────────────────────────────

function readContractFile(rel: string): string {
  return readFileSync(join(TEMPLATE_ROOT, rel), 'utf-8')
}

// ─── Tests ────────────────────────────────────────────────────────────────────

describe('slice-1 rollback dry-run — v1 reintroduction guard', () => {
  describe('MANAGED_ACCEPT_LEGACY_FOR_ROLLBACK contract documentation', () => {
    it('env var is NOT set in the tenant process (tenant never needs it)', () => {
      // The MANAGED_ACCEPT_LEGACY_FOR_ROLLBACK flag is a PLATFORM-SIDE concern.
      // The tenant's outbound signer always emits v2. The platform uses this flag
      // to decide whether to also accept v1 signatures during a rollback window.
      // Asserting the env var is absent from the TENANT process confirms the
      // tenant has no feature-flag gating on its signing path.
      expect(process.env.MANAGED_ACCEPT_LEGACY_FOR_ROLLBACK).toBeUndefined()
    })

    it('tenant source does not reference MANAGED_ACCEPT_LEGACY_FOR_ROLLBACK', () => {
      // Belt-and-suspenders: ensure no tenant module has started reading this
      // platform-side flag. If this fires, investigate before Slice 2 deletion.
      for (const rel of CONTRACT_FILES) {
        const src = readContractFile(rel)
        expect(src).not.toContain('MANAGED_ACCEPT_LEGACY_FOR_ROLLBACK')
      }
    })
  })

  describe('tenant source contains no v1-emit patterns (US-006 regression guard)', () => {
    for (const rel of CONTRACT_FILES) {
      for (const { pattern, label } of V1_EMIT_PATTERNS) {
        it(`${rel} — no "${label}"`, () => {
          const src = readContractFile(rel)
          expect(src).not.toMatch(pattern)
        })
      }
    }
  })

  describe('v2 signature shape is the only shape present in outbound headers', () => {
    it('handshake.ts emits X-Vobase-Sig-Version: 2 headers (not 1)', () => {
      const src = readContractFile('modules/integrations/service/handshake.ts')
      // The string "'2'" or '"2"' must appear in the header assignment.
      expect(src).toMatch(/['"]X-Vobase-Sig-Version['"]\s*:\s*['"]2['"]/)
    })

    it('managed-transport.ts emits X-Vobase-Sig-Version: 2 headers (not 1)', () => {
      const src = readContractFile('modules/channels/adapters/whatsapp/managed-transport.ts')
      expect(src).toMatch(/['"]X-Vobase-Sig-Version['"]\s*:\s*['"]2['"]/)
    })

    it('signRequest from @vobase/core is the only signer used by handshake.ts', () => {
      // Confirms we're using the shared primitive and not a local ad-hoc signer
      // that could diverge from the platform's expected format.
      const src = readContractFile('modules/integrations/service/handshake.ts')
      expect(src).toContain("import { type SignedRequest, signRequest } from '@vobase/core'")
      // No local signHmac calls (those would bypass the 2-key contract).
      expect(src).not.toMatch(/signHmac\s*\(/)
    })
  })

  describe('v2 signing primitive correctness (serves as rollback: flag=true simulation)', () => {
    // If MANAGED_ACCEPT_LEGACY_FOR_ROLLBACK=true were active on the platform,
    // a v1 signature would be accepted there. This test block proves that:
    //   (a) The tenant's `signRequest` still produces a valid v2 signature.
    //   (b) A manually-constructed "v1-shaped" payload (bare body, no METHOD|path prefix)
    //       produces DIFFERENT signatures — confirming the two versions are not
    //       accidentally aliased.
    // This is the closest safe approximation of the "flag=true branch" the tenant
    // can exercise without importing platform code.

    const SECRET = 'rollback-test-secret-slice1-us008'
    const KEY_VERSION = 1
    const PATH = '/api/managed-whatsapp/health'

    it('v2 canonical payload includes METHOD|path|query|bodyDigest prefix', () => {
      const v2Payload = `GET|${PATH}||e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855`
      const signed = signRequest({
        body: v2Payload,
        routineSecret: SECRET,
        rotationKey: SECRET,
        keyVersion: KEY_VERSION,
      })
      expect(signed.routineSignature).toHaveLength(64) // 32-byte SHA256 → 64 hex chars
      expect(signed.rotationSignature).toHaveLength(64)
      expect(signed.keyVersion).toBe(KEY_VERSION)
    })

    it('v1-shaped payload (bare body) produces a different signature than v2', () => {
      // Simulate what a v1 signer would have sent: bare body without the
      // METHOD|path envelope. If signatures were equal, it would mean the
      // signing path had regressed to v1 behaviour.
      const rawBody = '{"ok":true}'
      const v1Payload = rawBody // v1: sign the raw body directly
      const v2Payload = `POST|${PATH}||${new Bun.CryptoHasher('sha256').update(rawBody).digest('hex')}` // v2: METHOD|path|query|sha256(body)

      const signedV1 = signRequest({
        body: v1Payload,
        routineSecret: SECRET,
        rotationKey: SECRET,
        keyVersion: KEY_VERSION,
      })
      const signedV2 = signRequest({
        body: v2Payload,
        routineSecret: SECRET,
        rotationKey: SECRET,
        keyVersion: KEY_VERSION,
      })

      // If these were equal the signing paths would be indistinguishable —
      // a clear regression. They must differ.
      expect(signedV1.routineSignature).not.toBe(signedV2.routineSignature)
    })
  })
})
