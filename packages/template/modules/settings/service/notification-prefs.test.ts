/**
 * Unit tests for the notification-prefs matrix service.
 *
 * Focuses on the pure helpers that govern the matrix policy:
 *
 *   - `defaultMatrix(verified)` — dynamic WhatsApp default depends on the
 *     user's `phoneNumberVerified` flag.
 *   - `fillMatrix(stored, verified)` — sparse-to-full merge that the service
 *     uses on every `get(userId)`.
 *
 * The DB-touching service surface (`createNotificationPrefsService` + the
 * installable seam) is exercised by the integration suite in
 * `tests/integration/notification-matrix-fanout.integration.test.ts` and the
 * existing handler test in `modules/settings/handlers/index.test.ts` (which
 * uses `installNotificationPrefsService` with a stub). Re-deriving Drizzle's
 * AST shape inside a Bun unit test isn't worth the slop — the integration
 * suite covers the SQL roundtrip with a real Postgres in CI.
 */

import { describe, expect, it } from 'bun:test'

import { defaultMatrix, fillMatrix } from './notification-prefs'

describe('defaultMatrix', () => {
  it('returns in_app=true, whatsapp=false, email=false when phone unverified', () => {
    const m = defaultMatrix(false)
    expect(m.mention.in_app).toBe(true)
    expect(m.mention.whatsapp).toBe(false)
    expect(m.mention.email).toBe(false)
    expect(m.admin_alert.in_app).toBe(true)
    expect(m.admin_alert.whatsapp).toBe(false)
  })

  it('flips whatsapp to true once phone is verified', () => {
    const m = defaultMatrix(true)
    for (const kind of ['mention', 'decision', 'admin_alert'] as const) {
      expect(m[kind].in_app).toBe(true)
      expect(m[kind].whatsapp).toBe(true)
      expect(m[kind].email).toBe(false)
    }
  })
})

describe('fillMatrix', () => {
  it('fills missing kinds and cells from defaults', () => {
    const out = fillMatrix({}, false)
    expect(out.mention?.in_app).toBe(true)
    expect(out.mention?.whatsapp).toBe(false)
    expect(out.admin_alert?.email).toBe(false)
  })

  it('preserves explicit false even when the default is true', () => {
    const out = fillMatrix({ mention: { in_app: false } }, true)
    expect(out.mention?.in_app).toBe(false)
    expect(out.mention?.whatsapp).toBe(true) // unset → default
  })

  it('preserves explicit true when the default is false', () => {
    const out = fillMatrix({ decision: { email: true } }, false)
    expect(out.decision?.email).toBe(true)
    expect(out.decision?.in_app).toBe(true) // default
    expect(out.decision?.whatsapp).toBe(false) // unverified default
  })

  it('drops unknown kinds in stored input and projects only known kinds', () => {
    // biome-ignore lint/suspicious/noExplicitAny: deliberately invalid input
    const out = fillMatrix({ mention: { in_app: true }, bogus_kind: { in_app: true } } as any, false)
    expect(out.mention?.in_app).toBe(true)
    // bogus_kind is dropped — fillMatrix only iterates known NOTIFICATION_KINDS.
    expect((out as Record<string, unknown>).bogus_kind).toBeUndefined()
  })

  it('round-trips a full matrix unchanged', () => {
    const full = {
      mention: { in_app: false, whatsapp: true, email: true },
      decision: { in_app: true, whatsapp: true, email: false },
      admin_alert: { in_app: false, whatsapp: false, email: true },
    } as const
    const out = fillMatrix(full, false)
    expect(out).toEqual(full)
  })
})
