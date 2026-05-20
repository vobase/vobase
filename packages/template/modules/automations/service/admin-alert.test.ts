/**
 * Integration test: dispatchAdminAlert (US-012a / Slice C+).
 *
 * Verifies the 1-hour `(kind, dedupKey)` dedup contract AND the new
 * send path (staffPing / MagicLinkMintError handling introduced in US-012a).
 *
 * Tests:
 *   a. Happy path — one mock admin recipient + stub sendTemplate → succeeded run,
 *      staffPing not required (sendTemplate stub receives call).
 *   b. Dedup — within 1h window, second call returns suppressed_cooldown without
 *      calling sendTemplate.
 *   c. Mint failure — stub sendTemplate path where mintMagicLink throws
 *      MagicLinkMintError → failed run, reason='magic_link_mint_failed'.
 *   d. No recipients — org has no admin members with phoneNumber → failed run,
 *      reason='no_admin_recipients'.
 *   e. Window expiry — prior succeeded row older than 1h does not suppress.
 */

import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, mock } from 'bun:test'
import { MagicLinkMintError } from '@auth/magic-link'
import { __setMagicLinkEndpointIdForTests } from '@auth/magic-link-endpoint-config'
import {
  __resetAdminAlertForTests,
  ADMIN_ALERT_EVENT_NAME,
  ADMIN_ALERT_SENTINEL_RULE_ID,
  dispatchAdminAlert,
  installAdminAlertDeps,
} from '@modules/automations/service/admin-alert'
import { sql } from 'drizzle-orm'

import type { TestDbHandle } from '../../../tests/helpers/test-db'
import { connectTestDb, resetAndSeedDb } from '../../../tests/helpers/test-db'

// ─── Mock mintMagicLink so tests don't need a real better-auth instance ────────

// We mock the module before any imports of admin-alert happen. Because admin-alert
// imports mintMagicLink directly, we stub the auth/magic-link module.
let _mintMagicLinkImpl: (() => Promise<{ url: string; token: string; expiresAt: string }>) | null = null

mock.module('@auth/magic-link', () => ({
  MagicLinkMintError,
  mintMagicLink: async (..._args: unknown[]) => {
    if (_mintMagicLinkImpl) return _mintMagicLinkImpl()
    return {
      url: 'https://platform.vobase.dev/auth/magic?endpoint=t&token=tok&redirect=%2Fsystem%2Factivity&organization=org1',
      token: 'tok',
      expiresAt: new Date(Date.now() + 86400_000).toISOString(),
    }
  },
  magicLinkCaptor: { deliver: () => {} },
}))

// Stub getNotificationSettings to always return settings with vobase_admin_alert_v2 approved.
mock.module('@modules/channels/service/notification-settings', () => ({
  getNotificationSettings: async (_db: unknown, _orgId: string) => ({
    organizationId: 'stub',
    notificationEndpointId: 'ep-notif-stub',
    magicLinkEndpointId: 'ep-ml-stub',
    platformHmacSecretEnvelope: 'envelope-stub',
    platformBaseUrl: 'http://platform.test',
    displayPhoneNumber: '+15550001',
    phoneNumberId: 'pn-stub',
    wabaId: 'waba-stub',
    metaTemplateApprovals: { vobase_admin_alert_v2: 'approved' },
    lastVerifyStatus: null,
    lastVerifiedAt: null,
    createdAt: new Date(),
    updatedAt: new Date(),
  }),
}))

// Stub authMember + authUser joins used by resolveOrgAdmins.
// We inject recipients through the mock by controlling what the DB returns.
// Since this is an integration test with real Postgres, we plant real auth.member
// + auth.user rows via raw SQL instead of mocking the DB query.

describe('dispatchAdminAlert', () => {
  let handle: TestDbHandle

  beforeAll(async () => {
    await resetAndSeedDb()
    handle = connectTestDb()
  }, 60_000)

  beforeEach(() => {
    __resetAdminAlertForTests()
    _mintMagicLinkImpl = null
  })

  afterEach(() => {
    __resetAdminAlertForTests()
    __setMagicLinkEndpointIdForTests(null)
    _mintMagicLinkImpl = null
  })

  afterAll(async () => {
    __resetAdminAlertForTests()
    if (handle) await handle.teardown()
  })

  // ── Shared input builder ────────────────────────────────────────────────────

  function makeInput(orgId: string, dedupKey: string) {
    return {
      orgId,
      kind: 'budget_breach' as const,
      alertHeadline: 'Daily budget cap exceeded — automations paused',
      alertDetail: 'Cap $1.00 — spent $2.00 today. All automations paused.',
      dedupKey,
    }
  }

  // ── a. Happy path ───────────────────────────────────────────────────────────

  it('happy path: sends to admin with phone + writes succeeded run', async () => {
    const { db, client } = handle
    const orgId = `org-alert-happy-${Date.now()}`
    const dedupKey = `budget_breach:${orgId}:2026-05-17`

    // Plant auth.organization + auth.user + auth.member rows so resolveOrgAdmins finds a recipient.
    const orgSlug = `slug-happy-${Date.now()}`
    await client`INSERT INTO auth.organization (id, name, slug, created_at)
      VALUES (${orgId}, 'Test Org Happy', ${orgSlug}, now())`
    const userId = `usr-admin-${Date.now()}`
    await client`INSERT INTO auth.user (id, name, email, email_verified, phone_number, created_at, updated_at)
      VALUES (${userId}, 'Admin User', ${`${userId}@example.com`}, true, '+6591234567', now(), now())`
    await client`INSERT INTO auth.member (id, organization_id, user_id, role, created_at)
      VALUES (${`mem-${userId}`}, ${orgId}, ${userId}, 'owner', now())`

    const sentCalls: unknown[] = []
    const stubSendTemplate = async (input: unknown) => {
      sentCalls.push(input)
      return { ok: true as const, messageId: 'wamid.test', wireRoute: 'template' as const }
    }

    installAdminAlertDeps({
      db: db as unknown as Parameters<typeof installAdminAlertDeps>[0]['db'],
      sendTemplate: stubSendTemplate,
      // auth + endpointId omitted → mint skipped, bare suffix used
    })

    const result = await dispatchAdminAlert(makeInput(orgId, dedupKey))
    expect(result.status).toBe('sent')

    // sendTemplate should have been called once.
    expect(sentCalls.length).toBe(1)
    const call = sentCalls[0] as { staffPhoneE164: string; templateName: string }
    expect(call.staffPhoneE164).toBe('+6591234567')
    expect(call.templateName).toBe('vobase_admin_alert_v2')

    // automation_runs should have status='succeeded'.
    const rows = await client`
      SELECT status, payload_snapshot
      FROM automations.automation_runs
      WHERE organization_id = ${orgId} AND event_name = ${ADMIN_ALERT_EVENT_NAME}
      ORDER BY started_at DESC LIMIT 1
    `
    expect(rows.length).toBe(1)
    expect(rows[0].status).toBe('succeeded')
    expect((rows[0].payload_snapshot as { dedupKey?: string }).dedupKey).toBe(dedupKey)

    // Cleanup
    await db.execute(sql`DELETE FROM automations.automation_runs WHERE organization_id = ${orgId}`)
    await client`DELETE FROM auth.member WHERE organization_id = ${orgId}`
    await client`DELETE FROM auth.user WHERE id = ${userId}`
    await client`DELETE FROM auth.organization WHERE id = ${orgId}`
  })

  // ── b. Dedup still works ────────────────────────────────────────────────────

  it('dedup: second call within 1h returns suppressed_cooldown without calling sendTemplate', async () => {
    const { db, client } = handle
    const orgId = `org-alert-dedup-${Date.now()}`
    const dedupKey = `budget_breach:${orgId}:2026-05-17`

    // Plant a succeeded run directly (no need for real recipients for dedup test).
    await client`
      INSERT INTO automations.automation_runs
        (rule_id, organization_id, event_name, status, started_at, finished_at, payload_snapshot)
      VALUES
        (${ADMIN_ALERT_SENTINEL_RULE_ID}, ${orgId}, ${ADMIN_ALERT_EVENT_NAME}, 'succeeded',
         now(), now(), ${JSON.stringify({ dedupKey, kind: 'budget_breach' })}::jsonb)
    `

    const sentCalls: unknown[] = []
    const stubSendTemplate = async (input: unknown) => {
      sentCalls.push(input)
      return { ok: true as const, messageId: null, wireRoute: 'template' as const }
    }

    installAdminAlertDeps({
      db: db as unknown as Parameters<typeof installAdminAlertDeps>[0]['db'],
      sendTemplate: stubSendTemplate,
    })

    const result = await dispatchAdminAlert(makeInput(orgId, dedupKey))
    expect(result.status).toBe('suppressed_cooldown')
    // sendTemplate must NOT have been called.
    expect(sentCalls.length).toBe(0)

    // Verify the suppression row was written.
    const rows = await client`
      SELECT status, payload_snapshot
      FROM automations.automation_runs
      WHERE organization_id = ${orgId} AND event_name = ${ADMIN_ALERT_EVENT_NAME}
        AND status = 'suppressed_cooldown'
    `
    expect(rows.length).toBe(1)
    expect((rows[0].payload_snapshot as { reason?: string }).reason).toBe('admin_alert_dedup')

    await db.execute(sql`DELETE FROM automations.automation_runs WHERE organization_id = ${orgId}`)
  })

  // ── c. Mint failure → failure row ──────────────────────────────────────────

  it('mint failure: MagicLinkMintError → failed run + reason=magic_link_mint_failed', async () => {
    const { db, client } = handle
    const orgId = `org-alert-mint-${Date.now()}`
    const dedupKey = `budget_breach:${orgId}:2026-05-17`

    // Plant auth.organization + auth.user + auth.member so resolveOrgAdmins finds a recipient.
    const orgSlug = `slug-mint-${Date.now()}`
    await client`INSERT INTO auth.organization (id, name, slug, created_at)
      VALUES (${orgId}, 'Test Org Mint', ${orgSlug}, now())`
    const userId = `usr-mint-${Date.now()}`
    await client`INSERT INTO auth.user (id, name, email, email_verified, phone_number, created_at, updated_at)
      VALUES (${userId}, 'Admin Mint', ${`${userId}@example.com`}, true, '+6599990001', now(), now())`
    await client`INSERT INTO auth.member (id, organization_id, user_id, role, created_at)
      VALUES (${`mem-${userId}`}, ${orgId}, ${userId}, 'owner', now())`

    // Stub mintMagicLink to throw MagicLinkMintError.
    _mintMagicLinkImpl = () => {
      throw new MagicLinkMintError('magic_link_mint_failed', { cause: new Error('captor_timeout') })
    }

    // Use a stub auth + endpoint override so mint is attempted.
    const stubAuth = {} as Parameters<typeof installAdminAlertDeps>[0]['auth']
    __setMagicLinkEndpointIdForTests('platform-tenant-test')

    installAdminAlertDeps({
      db: db as unknown as Parameters<typeof installAdminAlertDeps>[0]['db'],
      auth: stubAuth,
    })

    const result = await dispatchAdminAlert(makeInput(orgId, dedupKey))
    expect(result.status).toBe('failed')
    if (result.status === 'failed') {
      expect(result.reason).toBe('magic_link_mint_failed')
    }

    const rows = await client`
      SELECT status, error_message
      FROM automations.automation_runs
      WHERE organization_id = ${orgId} AND event_name = ${ADMIN_ALERT_EVENT_NAME}
      ORDER BY started_at DESC LIMIT 1
    `
    expect(rows.length).toBe(1)
    expect(rows[0].status).toBe('failed')
    expect(rows[0].error_message).toBe('magic_link_mint_failed')

    await db.execute(sql`DELETE FROM automations.automation_runs WHERE organization_id = ${orgId}`)
    await client`DELETE FROM auth.member WHERE organization_id = ${orgId}`
    await client`DELETE FROM auth.user WHERE id = ${userId}`
    await client`DELETE FROM auth.organization WHERE id = ${orgId}`
  })

  // ── d. No recipients ────────────────────────────────────────────────────────

  it('no recipients: org with no owner+phone → failed run reason=no_admin_recipients', async () => {
    const { db, client } = handle
    const orgId = `org-alert-norec-${Date.now()}`
    const dedupKey = `budget_breach:${orgId}:2026-05-17`

    // No members planted → resolveOrgAdmins returns [].
    installAdminAlertDeps({
      db: db as unknown as Parameters<typeof installAdminAlertDeps>[0]['db'],
    })

    const result = await dispatchAdminAlert(makeInput(orgId, dedupKey))
    expect(result.status).toBe('failed')
    if (result.status === 'failed') {
      expect(result.reason).toBe('no_admin_recipients')
    }

    // Run row should still be written as succeeded (dedup-able) with reason in payload.
    const rows = await client`
      SELECT status, payload_snapshot
      FROM automations.automation_runs
      WHERE organization_id = ${orgId} AND event_name = ${ADMIN_ALERT_EVENT_NAME}
      ORDER BY started_at DESC LIMIT 1
    `
    expect(rows.length).toBe(1)
    expect(rows[0].status).toBe('succeeded')
    expect((rows[0].payload_snapshot as { reason?: string }).reason).toBe('no_admin_recipients')

    await db.execute(sql`DELETE FROM automations.automation_runs WHERE organization_id = ${orgId}`)
  })

  // ── e. Window expiry ────────────────────────────────────────────────────────

  it('dispatch with same dedupKey past the 1h window does not suppress', async () => {
    const { db, client } = handle
    const orgId = `org-alert-window-${Date.now()}`
    const dedupKey = `budget_breach:${orgId}:2026-05-17`

    // Plant a "prior" succeeded row that is 70 minutes old.
    const priorStart = new Date(Date.now() - 70 * 60 * 1000)
    await client`
      INSERT INTO automations.automation_runs
        (rule_id, organization_id, event_name, status, started_at, finished_at, payload_snapshot)
      VALUES
        (${ADMIN_ALERT_SENTINEL_RULE_ID}, ${orgId}, ${ADMIN_ALERT_EVENT_NAME}, 'succeeded',
         ${priorStart.toISOString()}, ${priorStart.toISOString()},
         ${JSON.stringify({ dedupKey, kind: 'budget_breach' })}::jsonb)
    `

    // No real recipients → will return no_admin_recipients, but crucially NOT suppressed_cooldown.
    installAdminAlertDeps({
      db: db as unknown as Parameters<typeof installAdminAlertDeps>[0]['db'],
    })

    const result = await dispatchAdminAlert(makeInput(orgId, dedupKey))
    // Should NOT be suppressed_cooldown — the prior row is outside the 1h window.
    expect(result.status).not.toBe('suppressed_cooldown')

    await db.execute(sql`DELETE FROM automations.automation_runs WHERE organization_id = ${orgId}`)
  })
})
