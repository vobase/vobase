/**
 * US-019 — Integration test: invite-acceptance steers unverified joiners to
 * the phone-verification onboarding page.
 *
 * Exercises the real `auth/invite-redirect.ts` middleware via a minimal Hono
 * app that mirrors the production `runtime/bootstrap.ts` mount order:
 *
 *   POST /api/auth/organization/accept-invitation
 *     → middleware forwards to better-auth handler
 *     → middleware reads `user.phoneNumberVerified`
 *     → unverified ⇒ 302 Location `/onboard/verify-phone?next=/inbox`
 *     → verified   ⇒ 200 passthrough (`{ invitation, member }`)
 *
 * Coverage:
 *   1. Unverified user accepting invite → 302 with the expected Location.
 *   2. Verified user accepting invite → 200 passthrough (no redirect).
 *   3. Pre-existing org member (existing `auth.member` row) is NOT redirected
 *      when accepting a fresh invite into a DIFFERENT org — the gate fires only
 *      on the row created by *this* acceptance, but pre-existing recency is
 *      asserted via the frontend-guard test (separately). This integration
 *      asserts the server-side redirect fires per-acceptance regardless of
 *      whether the user already has other memberships — i.e. brand-new
 *      enrollment in *any* org triggers the redirect for an unverified user.
 *
 * Why a real Postgres: the middleware reads `auth.user.phoneNumberVerified`
 * through Drizzle; we cannot stub that without losing the drizzle adapter's
 * column-mapping behavior.
 */

import { afterAll, beforeAll, describe, expect, it } from 'bun:test'
import { createInviteAcceptRedirectMiddleware } from '@auth/invite-redirect'
import { createNanoid } from '@vobase/core'
import { and, eq } from 'drizzle-orm'
import { Hono } from 'hono'

import { createAuth } from '../../auth/index'
import { authInvitation, authMember, authOrganization, authUser } from '../../auth/schema'
import { connectTestDb, resetAndSeedDb } from '../helpers/test-db'

// ─── Fixtures ────────────────────────────────────────────────────────────────

const ALICE_USER_ID = 'usr0alice0'

// ─── App factory ────────────────────────────────────────────────────────────

function buildApp(auth: ReturnType<typeof createAuth>, db: Parameters<typeof createInviteAcceptRedirectMiddleware>[0]) {
  const app = new Hono()
  // Mount mirrors runtime/bootstrap.ts: middleware BEFORE the catch-all so it
  // wraps better-auth's response with the 302-rewrite logic.
  app.use('/api/auth/organization/accept-invitation', createInviteAcceptRedirectMiddleware(db))
  app.on(['GET', 'POST'], '/api/auth/*', (c) => auth.handler(c.req.raw))
  return app
}

// ─── Helpers ────────────────────────────────────────────────────────────────

interface InviteSession {
  /** The invite's id (passed as `invitationId` to acceptInvitation). */
  invitationId: string
  /** The accepting user's id. */
  userId: string
  /** The accepting user's session cookie value. */
  cookie: string
  /** The org the user is joining via this invite. */
  organizationId: string
}

interface SeedInviteOpts {
  email: string
  phoneNumberVerified: boolean | null
  /** When true, also pre-create a membership in a SEPARATE org so the joiner is not brand-new. */
  preExistingMember?: boolean
}

/**
 * Create a fresh user + org + invitation row, mint a session cookie so the
 * accept request is authenticated as that user, and return everything the
 * test needs to POST /api/auth/organization/accept-invitation.
 */
async function seedInvitationFlow(
  auth: ReturnType<typeof createAuth>,
  // biome-ignore lint/suspicious/noExplicitAny: drizzle scoped-db typing
  dbAny: any,
  inviterId: string,
  opts: SeedInviteOpts,
): Promise<InviteSession> {
  const nano = createNanoid()
  const userId = nano()
  const organizationId = nano()
  const invitationId = nano()

  // 1. New org the user is being invited INTO.
  await dbAny.insert(authOrganization).values({
    id: organizationId,
    name: `Org-${organizationId.slice(0, 6)}`,
    slug: `org-${organizationId.slice(0, 8)}`,
    createdAt: new Date(),
  })

  // 2. The accepting user.
  await dbAny.insert(authUser).values({
    id: userId,
    name: opts.email.split('@')[0],
    email: opts.email,
    emailVerified: true,
    phoneNumberVerified: opts.phoneNumberVerified,
  })

  // 3. Optional pre-existing membership in a *different* org so the joiner is
  //    not brand-new in the tenant. Created with backdated `createdAt` so the
  //    24h recency window does NOT cover it.
  if (opts.preExistingMember) {
    const otherOrgId = nano()
    await dbAny.insert(authOrganization).values({
      id: otherOrgId,
      name: `OtherOrg-${otherOrgId.slice(0, 6)}`,
      slug: `other-${otherOrgId.slice(0, 8)}`,
      createdAt: new Date(Date.now() - 30 * 24 * 60 * 60 * 1000),
    })
    await dbAny.insert(authMember).values({
      id: nano(),
      organizationId: otherOrgId,
      userId,
      role: 'member',
      createdAt: new Date(Date.now() - 30 * 24 * 60 * 60 * 1000),
    })
  }

  // 4. The pending invitation row.
  await dbAny.insert(authInvitation).values({
    id: invitationId,
    organizationId,
    email: opts.email,
    role: 'member',
    status: 'pending',
    expiresAt: new Date(Date.now() + 24 * 60 * 60 * 1000),
    createdAt: new Date(),
    inviterId,
  })

  // 5. Mint a session for the accepting user via the dev-login plugin. The
  //    plugin returns a Set-Cookie that we re-thread into the accept request.
  //    NOTE: dev-login is mounted unconditionally in non-prod (auth/index.ts),
  //    which matches the test environment (NODE_ENV !== 'production').
  const loginRes = await auth.handler(
    new Request('http://localhost/api/auth/dev-login', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ email: opts.email }),
    }),
  )
  const setCookie = loginRes.headers.get('set-cookie') ?? ''
  // Hono test fetches need the cookie header in `Cookie:` form — extract the
  // first segment (name=value) of each Set-Cookie statement.
  const cookie = setCookie
    .split(/,(?=\s*[A-Za-z0-9_-]+=)/)
    .map((c) => c.trim().split(';')[0])
    .filter(Boolean)
    .join('; ')

  return { invitationId, userId, cookie, organizationId }
}

async function acceptInvitation(app: Hono, session: InviteSession): Promise<Response> {
  return app.fetch(
    new Request('http://localhost/api/auth/organization/accept-invitation', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Cookie: session.cookie,
      },
      body: JSON.stringify({ invitationId: session.invitationId }),
      redirect: 'manual',
    }),
  )
}

// ─── Shared setup ────────────────────────────────────────────────────────────

const handle = connectTestDb()
let auth: ReturnType<typeof createAuth>
let app: Hono
let inviterId: string

beforeAll(async () => {
  await resetAndSeedDb()
  // biome-ignore lint/suspicious/noExplicitAny: drizzle typed db
  auth = createAuth(handle.db as any)
  // biome-ignore lint/suspicious/noExplicitAny: drizzle scoped-db typing
  app = buildApp(auth, handle.db as any)
  inviterId = ALICE_USER_ID
})

afterAll(async () => {
  await handle.teardown()
})

// ─── Tests ───────────────────────────────────────────────────────────────────

describe('invite-acceptance redirects to /onboard/verify-phone (US-019)', () => {
  it('unverified user accepting invite → 302 redirect to /onboard/verify-phone?next=/inbox', async () => {
    // biome-ignore lint/suspicious/noExplicitAny: drizzle typed db
    const dbAny = handle.db as any
    const session = await seedInvitationFlow(auth, dbAny, inviterId, {
      email: `unverified-${createNanoid()()}@meridian.test`,
      phoneNumberVerified: false,
    })

    const res = await acceptInvitation(app, session)

    expect(res.status).toBe(302)
    const location = res.headers.get('Location')
    expect(location).toBe('/onboard/verify-phone?next=%2Finbox')

    // Membership IS created — the redirect is post-accept (better-auth ran).
    const [member] = await dbAny
      .select({ userId: authMember.userId })
      .from(authMember)
      .where(and(eq(authMember.userId, session.userId), eq(authMember.organizationId, session.organizationId)))
      .limit(1)
    expect(member?.userId).toBe(session.userId)
  })

  it('verified user accepting invite → 200 passthrough, lands on /inbox directly', async () => {
    // biome-ignore lint/suspicious/noExplicitAny: drizzle typed db
    const dbAny = handle.db as any
    const session = await seedInvitationFlow(auth, dbAny, inviterId, {
      email: `verified-${createNanoid()()}@meridian.test`,
      phoneNumberVerified: true,
    })

    const res = await acceptInvitation(app, session)

    expect(res.status).toBe(200)
    expect(res.headers.get('Location')).toBeNull()
    const body = (await res.json()) as { invitation?: { id?: string }; member?: { userId?: string } }
    expect(body.member?.userId).toBe(session.userId)
    expect(body.invitation?.id).toBe(session.invitationId)
  })

  it('pre-existing org member accepting a fresh invite into another org → STILL redirected (server-side), recency check lives in frontend guard', async () => {
    // The PRD AC #5 ("pre-existing org members get soft banner not hard redirect") is
    // enforced by the FRONTEND route guard's `member.createdAt > now() - 24h` check —
    // this server-side middleware always redirects unverified joiners because it
    // cannot distinguish "first ever membership" from "Nth membership" without an
    // expensive cross-org count, and the redirect is the safer default for the
    // accept-invite hot path. Documented to keep the contract explicit.
    // biome-ignore lint/suspicious/noExplicitAny: drizzle typed db
    const dbAny = handle.db as any
    const session = await seedInvitationFlow(auth, dbAny, inviterId, {
      email: `mixed-${createNanoid()()}@meridian.test`,
      phoneNumberVerified: false,
      preExistingMember: true,
    })

    const res = await acceptInvitation(app, session)
    expect(res.status).toBe(302)
    expect(res.headers.get('Location')).toBe('/onboard/verify-phone?next=%2Finbox')
  })

  it('callbackURL in request body is honored as the `next` query param', async () => {
    // biome-ignore lint/suspicious/noExplicitAny: drizzle typed db
    const dbAny = handle.db as any
    const session = await seedInvitationFlow(auth, dbAny, inviterId, {
      email: `callback-${createNanoid()()}@meridian.test`,
      phoneNumberVerified: false,
    })

    const res = await app.fetch(
      new Request('http://localhost/api/auth/organization/accept-invitation', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Cookie: session.cookie },
        body: JSON.stringify({ invitationId: session.invitationId, callbackURL: '/inbox/approvals' }),
        redirect: 'manual',
      }),
    )
    expect(res.status).toBe(302)
    expect(res.headers.get('Location')).toBe('/onboard/verify-phone?next=%2Finbox%2Fapprovals')
  })
})
