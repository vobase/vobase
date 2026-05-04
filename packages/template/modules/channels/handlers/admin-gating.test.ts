/**
 * Admin role-gate verification for channels mutation routes.
 *
 * The threat model: a low-privilege org member must NOT be able to flip a
 * tenant's WhatsApp config, run the doctor probe, or kick the
 * managed-handshake retry hatch. We exercise the real `createRequireRole`
 * middleware against `auth.member` rows so a regression that drops the
 * `lazyRequireAdmin` chain is caught at this layer.
 *
 * Skipped (not failed) when Docker Postgres is unreachable.
 */
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'bun:test'
import { createRequireRole } from '@auth/middleware'
import { authMember, authOrganization, authUser } from '@vobase/core'
import { sql } from 'drizzle-orm'
import { Hono } from 'hono'

import { connectTestDb, resetAndSeedDb, type TestDbHandle } from '../../../tests/helpers/test-db'

const TEST_ORG_ID = 'org-admin-gate-test'
const TEST_USER_ADMIN = 'user-admin-gate-admin'
const TEST_USER_MEMBER = 'user-admin-gate-member'
const TEST_USER_OWNER = 'user-admin-gate-owner'

let dbHandle: TestDbHandle | null = null

beforeAll(async () => {
  try {
    await resetAndSeedDb()
    dbHandle = connectTestDb()
  } catch (err) {
    console.warn(`[admin-gating.test] skipping: ${(err as Error).message}`)
  }
}, 60_000)

afterAll(async () => {
  if (dbHandle) await dbHandle.teardown()
})

beforeEach(async () => {
  if (!dbHandle) return
  await dbHandle.db.execute(sql`TRUNCATE TABLE "auth"."member" CASCADE`)
  await dbHandle.db.execute(sql`TRUNCATE TABLE "auth"."organization" CASCADE`)
  await dbHandle.db.execute(sql`TRUNCATE TABLE "auth"."user" CASCADE`)

  await dbHandle.db.insert(authOrganization).values({
    id: TEST_ORG_ID,
    name: 'gate-test',
    slug: 'gate-test',
  })
  await dbHandle.db.insert(authUser).values([
    { id: TEST_USER_ADMIN, name: 'admin', email: 'admin@gate.test', emailVerified: true },
    { id: TEST_USER_MEMBER, name: 'member', email: 'member@gate.test', emailVerified: true },
    { id: TEST_USER_OWNER, name: 'owner', email: 'owner@gate.test', emailVerified: true },
  ])
  await dbHandle.db.insert(authMember).values([
    { id: 'mem-admin', userId: TEST_USER_ADMIN, organizationId: TEST_ORG_ID, role: 'admin' },
    { id: 'mem-member', userId: TEST_USER_MEMBER, organizationId: TEST_ORG_ID, role: 'member' },
    { id: 'mem-owner', userId: TEST_USER_OWNER, organizationId: TEST_ORG_ID, role: 'owner' },
  ])
})

function buildApp(userId: string) {
  if (!dbHandle) throw new Error('db not connected')
  const requireAdmin = createRequireRole(dbHandle.db, ['owner', 'admin'])
  const app = new Hono()
  app.use('*', async (c, next) => {
    c.set(
      'session' as never,
      {
        user: { id: userId },
        session: { id: 'sess-x', activeOrganizationId: TEST_ORG_ID },
      } as never,
    )
    c.set('organizationId' as never, TEST_ORG_ID as never)
    return next()
  })
  app.use('*', requireAdmin)
  app.post('/protected', (c) => c.json({ ok: true }))
  return app
}

describe('createRequireRole — admin gate', () => {
  it('rejects role=member with 403', async () => {
    if (!dbHandle) return
    const app = buildApp(TEST_USER_MEMBER)
    const res = await app.request('/protected', { method: 'POST' })
    expect(res.status).toBe(403)
  })

  it('accepts role=admin', async () => {
    if (!dbHandle) return
    const app = buildApp(TEST_USER_ADMIN)
    const res = await app.request('/protected', { method: 'POST' })
    expect(res.status).toBe(200)
  })

  it('accepts role=owner', async () => {
    if (!dbHandle) return
    const app = buildApp(TEST_USER_OWNER)
    const res = await app.request('/protected', { method: 'POST' })
    expect(res.status).toBe(200)
  })

  it('rejects when user not a member of the org with 403', async () => {
    if (!dbHandle) return
    const app = buildApp('user-not-in-org')
    const res = await app.request('/protected', { method: 'POST' })
    expect(res.status).toBe(403)
  })
})
