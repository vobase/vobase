import { productName } from '@auth/branding'
import { nameFromEmail } from '@auth/display-name'
import { createNanoid, logger } from '@vobase/core'
import { betterAuth } from 'better-auth'
import { drizzleAdapter } from 'better-auth/adapters/drizzle'
import { and, desc, eq, sql } from 'drizzle-orm'

import type { ScopedDb } from '~/runtime'
import { devAuth } from './dev-plugin'
import { renderInvitationEmail, renderOtpEmail } from './emails'
import { sendEmail } from './emails/sender'
import { magicVerifyHmacPlugin } from './magic-verify-plugin'
import { platformAuth } from './platform-plugin'
import { buildAuthPlugins } from './plugins'
import {
  authAccount,
  authApikey,
  authInvitation,
  authMember,
  authOrganization,
  authSession,
  authTeam,
  authTeamMember,
  authUser,
  authVerification,
} from './schema'
import { generateVisitorName } from './visitor-name'

const authTableMap = {
  user: authUser,
  session: authSession,
  account: authAccount,
  verification: authVerification,
  apikey: authApikey,
  organization: authOrganization,
  member: authMember,
  invitation: authInvitation,
  team: authTeam,
  teamMember: authTeamMember,
}

function parseAllowedEmailDomains(): string[] {
  const raw = process.env.ALLOWED_EMAIL_DOMAINS ?? process.env.VITE_ALLOWED_EMAIL_DOMAINS ?? ''
  return raw
    .split(',')
    .map((d) => d.trim())
    .filter((d) => d.length > 0)
}

export function createAuth(db: ScopedDb) {
  // Single-project default: orgs are opt-in for "multiple companies under one
  // install" setups (e.g. agency serving N clients). `allowUserToCreateOrganization`
  // stays false until a project explicitly flips VOBASE_MULTI_ORG=true — keeps
  // sign-up flow dead simple for the common single-org case.
  const multiOrg = process.env.VOBASE_MULTI_ORG === 'true'

  const platformSecret = process.env.PLATFORM_HMAC_SECRET
  const allowedDomains = parseAllowedEmailDomains()

  // The plugin list is built as a single expression (rather than `push`-ing
  // onto a `BetterAuthPlugin[]`) so TypeScript keeps the precise per-plugin
  // types — that's what makes `auth.api.createApiKey` / `verifyApiKey` etc.
  // visible on the returned `Auth` type.
  const plugins = [
    ...buildAuthPlugins({
      multiOrg,
      generateAnonymousName: () => generateVisitorName(db),
      sendVerificationOTP: async ({ email, otp, type }) => {
        try {
          const html = await renderOtpEmail({ otp, type })
          await sendEmail({
            to: email,
            subject: `[${productName}] Your sign-in verification code`,
            html,
          })
        } catch (err) {
          logger.error(
            { error: err instanceof Error ? err.message : String(err), email, type },
            '[auth:otp] Failed to send verification email',
          )
          throw err
        }
      },
      sendInvitationEmail: async ({ email, inviter, organization: org, id: invitationId }) => {
        try {
          const baseUrl = process.env.BETTER_AUTH_URL || 'http://localhost:5173'
          const signInUrl = `${baseUrl}/auth/login?invitationId=${encodeURIComponent(invitationId)}`
          const html = await renderInvitationEmail({
            inviterName: inviter.user.name ?? inviter.user.email,
            organizationName: org.name,
            signInUrl,
          })
          await sendEmail({
            to: email,
            subject: `[${productName}] You've been invited to ${org.name}`,
            html,
          })
        } catch (err) {
          logger.error(
            {
              error: err instanceof Error ? err.message : String(err),
              email,
              organizationId: org.id,
            },
            '[auth:invite] Failed to send invitation email',
          )
          throw err
        }
      },
    }),
    ...(platformSecret
      ? [
          platformAuth({
            hmacSecret: platformSecret,
            allowedEmailDomains: allowedDomains,
            hasPendingInvitation: async (email) => {
              // biome-ignore lint/suspicious/noExplicitAny: drizzle scoped-db typing
              const dbAny = db as any
              const rows = await dbAny
                .select({ id: authInvitation.id })
                .from(authInvitation)
                .where(and(eq(authInvitation.email, email), eq(authInvitation.status, 'pending')))
                .limit(1)
              return rows.length > 0
            },
          }),
        ]
      : []),
    // Platform-to-tenant HMAC endpoints: /verify-magic-link + /set-active-organization.
    // Contributes NO schema (endpoint-only plugin); safe to include unconditionally.
    magicVerifyHmacPlugin(db),
    ...(process.env.NODE_ENV !== 'production' ? [devAuth()] : []),
  ]

  // Auto-enroll new users so invited members land straight in /team. On
  // invitation accept we also mint a staff_profiles row so the invitee
  // shows up in the roster immediately.
  // biome-ignore lint/suspicious/noExplicitAny: drizzle scoped-db typing
  const dbAny = db as any

  const ensureStaffProfile = async (userId: string, organizationId: string): Promise<void> => {
    try {
      // biome-ignore lint/plugin/no-dynamic-import: avoids module-init cycle (auth → team schema → auth)
      const { staffProfiles } = await import('@modules/team/schema')
      const [u] = await dbAny
        .select({ name: authUser.name, email: authUser.email })
        .from(authUser)
        .where(eq(authUser.id, userId))
        .limit(1)
      const rawName = u?.name?.trim() || ''
      const displayName = rawName || (u?.email ? nameFromEmail(u.email) : null)
      await dbAny
        .insert(staffProfiles)
        .values({ userId, organizationId, displayName })
        .onConflictDoNothing({ target: staffProfiles.userId })
    } catch (err) {
      logger.error(
        { error: err instanceof Error ? err.message : String(err), userId, organizationId },
        '[auth] staff-profile ensure failed',
      )
    }
  }

  const autoEnroll = async (user: { id: string; email: string }): Promise<void> => {
    // Process the pending invite FIRST — must run regardless of any existing
    // membership (bootstrap "Workspace", another tenant, leftover from prior
    // signup). Match the invitation email case-insensitively because
    // better-auth lowercases user emails on creation, while invitations may
    // have been entered mixed-case by the admin.
    const inviteEmail = user.email.toLowerCase()
    const [invite] = await dbAny
      .select({
        id: authInvitation.id,
        organizationId: authInvitation.organizationId,
        role: authInvitation.role,
        phoneNumber: authInvitation.phoneNumber,
      })
      .from(authInvitation)
      .where(and(eq(sql`lower(${authInvitation.email})`, inviteEmail), eq(authInvitation.status, 'pending')))
      .limit(1)
    if (invite) {
      // Create the member row so the user lands in the org immediately — even
      // in edge cases where the SPA's explicit acceptInvitation call never
      // fires (OAuth sign-up, dev-login, etc.).
      //
      // IMPORTANT: we deliberately do NOT update authInvitation.status here.
      // The invitation must stay 'pending' so better-auth's accept-invitation
      // endpoint (POST /api/auth/organization/accept-invitation) can process it
      // normally. That endpoint checks status === 'pending' and returns 400 if
      // already accepted. The SPA calls acceptInvitation after OTP verify, and
      // the invite-redirect middleware wraps that 200 response to steer
      // unverified joiners to /onboard/verify-phone.
      //
      // `auth.member` has no UNIQUE on (user_id, organization_id) — pre-check
      // inside a transaction to avoid duplicate-row errors on concurrent wakes.
      await dbAny.transaction(async (tx: typeof dbAny) => {
        const [already] = await tx
          .select({ id: authMember.id })
          .from(authMember)
          .where(and(eq(authMember.userId, user.id), eq(authMember.organizationId, invite.organizationId)))
          .limit(1)
        if (!already) {
          await tx.insert(authMember).values({
            id: createNanoid()(),
            userId: user.id,
            organizationId: invite.organizationId,
            role: invite.role,
          })
        }
      })
      logger.info({ email: user.email }, '[auth] Auto-enrolled from pending invitation (invite status unchanged)')
      // Optional phone the admin set on the invite — copy it onto the user.
      // Best-effort: a unique-collision (phone already in use) must not block
      // enrollment, so it's written outside the membership tx.
      if (invite.phoneNumber) {
        try {
          await dbAny.update(authUser).set({ phoneNumber: invite.phoneNumber }).where(eq(authUser.id, user.id))
        } catch (err) {
          logger.warn(
            { error: err instanceof Error ? err.message : String(err), email: user.email },
            '[auth] invite phone-number write failed (non-fatal)',
          )
        }
      }
      await ensureStaffProfile(user.id, invite.organizationId)
      return
    }

    // No matching invite — short-circuit if the user already has any
    // membership (bootstrap workspace, another tenant). The bootstrap
    // fallback below should only fire for truly new users.
    const [existing] = await dbAny
      .select({ id: authMember.id })
      .from(authMember)
      .where(eq(authMember.userId, user.id))
      .limit(1)
    if (existing) return

    if (multiOrg) return
    if (allowedDomains.length > 0) {
      const domain = user.email.split('@')[1]?.toLowerCase()
      if (!domain || !allowedDomains.map((d) => d.toLowerCase()).includes(domain)) return
    }
    let [soleOrg] = await dbAny
      .select({ id: authOrganization.id })
      .from(authOrganization)
      .orderBy(authOrganization.createdAt)
      .limit(1)
    if (!soleOrg) {
      // Bootstrap: fresh single-org tenant. Platform stamps VITE_PLATFORM_TENANT_{NAME,SLUG} at
      // deploy time; slug must be deterministic so the unique index serializes concurrent
      // first-signups — second insert hits 23505, we re-read and join the winner's org.
      const orgName = process.env.VITE_PLATFORM_TENANT_NAME?.trim() || 'Workspace'
      const orgSlug = process.env.VITE_PLATFORM_TENANT_SLUG?.trim() || 'workspace'
      const newOrgId = createNanoid()()
      try {
        await dbAny.insert(authOrganization).values({ id: newOrgId, name: orgName, slug: orgSlug })
        soleOrg = { id: newOrgId }
        logger.info({ email: user.email, organizationId: newOrgId }, '[auth] Bootstrapped first organization')
      } catch (err) {
        const code = (err as { code?: string } | null)?.code
        if (code !== '23505') throw err
        const [retry] = await dbAny
          .select({ id: authOrganization.id })
          .from(authOrganization)
          .orderBy(authOrganization.createdAt)
          .limit(1)
        if (!retry) {
          logger.error({ email: user.email }, '[auth] Bootstrap unique-violation but no org visible on re-read')
          return
        }
        soleOrg = retry
      }
    }
    const [firstMember] = await dbAny
      .select({ id: authMember.id })
      .from(authMember)
      .where(eq(authMember.organizationId, soleOrg.id))
      .limit(1)
    // `auth.member` has no UNIQUE on (user_id, organization_id); fall back to
    // a bare ON CONFLICT DO NOTHING so a concurrent racer (same user, same
    // bootstrap org) loses cleanly instead of throwing.
    await dbAny
      .insert(authMember)
      .values({
        id: createNanoid()(),
        userId: user.id,
        organizationId: soleOrg.id,
        role: firstMember ? 'member' : 'owner',
      })
      .onConflictDoNothing()
    logger.info({ email: user.email, role: firstMember ? 'member' : 'owner' }, '[auth] Auto-enrolled into sole org')
    await ensureStaffProfile(user.id, soleOrg.id)
  }

  return betterAuth({
    // biome-ignore lint/suspicious/noExplicitAny: drizzle-adapter accepts any drizzle instance
    database: drizzleAdapter(db as any, { provider: 'pg', schema: authTableMap }),
    emailAndPassword: { enabled: false },
    plugins,
    trustedOrigins: [
      'https://platform.vobase.dev',
      // baseURL's own origin is implicitly trusted by better-auth — this list is additive.
    ],
    databaseHooks: {
      user: {
        create: {
          after: async (user) => {
            try {
              await autoEnroll({ id: user.id, email: user.email })
            } catch (err) {
              logger.error(
                { error: err instanceof Error ? err.message : String(err), email: user.email },
                '[auth] auto-enroll failed',
              )
            }
          },
        },
      },
      member: {
        create: {
          // Fires when Better Auth itself creates a member row (direct org
          // add). `autoEnroll` bypasses the adapter so it calls
          // ensureStaffProfile explicitly — this hook covers everything else.
          after: async (member: { userId: string; organizationId: string }) => {
            await ensureStaffProfile(member.userId, member.organizationId)
          },
        },
      },
      session: {
        create: {
          before: async (session) => {
            // Covers pre-existing users who signed up before this hook existed:
            // run auto-enroll and set activeOrganizationId on the new session.
            try {
              const [u] = await dbAny
                .select({ id: authUser.id, email: authUser.email })
                .from(authUser)
                .where(eq(authUser.id, session.userId))
                .limit(1)
              if (u) await autoEnroll(u)
              // Prefer the most-recently-created membership so users who just
              // accepted an invite land in the new org's inbox (not whatever
              // membership happened to sort first for multi-org users).
              const [m] = await dbAny
                .select({ organizationId: authMember.organizationId })
                .from(authMember)
                .where(eq(authMember.userId, session.userId))
                .orderBy(desc(authMember.createdAt))
                .limit(1)
              if (m && !session.activeOrganizationId) {
                return { data: { ...session, activeOrganizationId: m.organizationId } }
              }
            } catch (err) {
              logger.error(
                { error: err instanceof Error ? err.message : String(err), userId: session.userId },
                '[auth] session-create auto-enroll failed',
              )
            }
            return undefined
          },
        },
      },
    },
    session: {
      // 5 minutes of signed-cookie cache — avoids a DB hit for `getSession` in
      // `requireSession` on every request. Invalidation is immediate on
      // sign-out/revoke because better-auth re-signs the cookie on those flows.
      cookieCache: { enabled: true, maxAge: 5 * 60 },
    },
    advanced: {
      useSecureCookies: process.env.NODE_ENV === 'production',
      // Match our manual inserts + domain tables that use `nanoidPrimaryKey()`.
      database: { generateId: () => createNanoid()() },
    },
  })
}

export type Auth = ReturnType<typeof createAuth>
