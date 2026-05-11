/** @contract platform-tenant-v1 */
/**
 * phone — canonical WhatsApp ID normalizer (tenant side).
 *
 * Per §4.2: byte-stable with vobase-platform's `lib/phone.ts`. The shared
 * fixture at `packages/template/tests/fixtures/wa-id-normalize.json` (mirrored
 * byte-for-byte from `vobase-platform/db/fixtures/wa-id-normalize.json`)
 * validates parity; if either side drifts the test fails on both sides on
 * the next CI run.
 *
 * WhatsApp IDs are E.164-shaped numeric strings: 7-15 digits, no leading
 * zero, no `+` prefix when stored. Tenants accept the human-typed `+`
 * variant and trim whitespace before validating; the canonical form
 * returned here is always digits-only.
 */
import { validation } from '@vobase/core'

const WA_ID_PATTERN = /^[1-9]\d{6,14}$/

export function normalizeWaId(input: string): string {
  const trimmed = input.trim().replace(/^\+/, '')
  if (!WA_ID_PATTERN.test(trimmed)) {
    throw validation({ input }, `invalid WhatsApp ID '${input}': expected E.164 digits without leading zero`)
  }
  return trimmed
}
