import type { ScopedDb } from '@server/common/scoped-db'
import {
  authAccount,
  authInvitation,
  authMember,
  authOrganization,
  authSession,
  authTeam,
  authTeamMember,
  authUser,
  authVerification,
  createNanoid,
  logger,
} from '@vobase/core'
import { type BetterAuthPlugin, betterAuth } from 'better-auth'
import { drizzleAdapter } from 'better-auth/adapters/drizzle'
import { anonymous } from 'better-auth/plugins/anonymous'
import { bearer } from 'better-auth/plugins/bearer'
import { emailOTP } from 'better-auth/plugins/email-otp'
import { organization } from 'better-auth/plugins/organization'
import { and, eq } from 'drizzle-orm'

import { productName } from '../branding'
import { renderInvitationEmail, renderOtpEmail } from '../emails'
import { sendEmail } from '../emails/sender'
import { ac, roles } from './ac'
import { devAuth } from './dev-plugin'
import { platformAuth } from './platform-plugin'

const authTableMap = {
  user: authUser,
  session: authSession,
  account: authAccount,
  verification: authVerification,
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

  const plugins: BetterAuthPlugin[] = [
    // Bearer tokens let the public /chat page authenticate via
    // `Authorization: Bearer <token>` instead of cookies. That isolates the
    // widget's anonymous session from the dashboard cookie session on the
    // same origin.
    bearer(),
    anonymous(),
    emailOTP({
      sendVerificationOTP: async ({ email, otp, type }) => {
        try {
          const html = await renderOtpEmail({ otp, type })
          await sendEmail({
            to: email,
            subject: `[${productName}] Your sign-in verification code`,
            html,
          })
        } catch (err) {
          logger.error('[auth:otp] Failed to send verification email', {
            error: err instanceof Error ? err.message : String(err),
            email,
            type,
          })
          throw err
        }
      },
      otpLength: 6,
      expiresIn: 300,
    }),
    organization({
      allowUserToCreateOrganization: multiOrg,
      ac,
      roles,
      teams: {
        enabled: true,
        allowRemovingAllTeams: false,
      },
      async sendInvitationEmail({ email, inviter, organization: org, id: invitationId }) {
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
          logger.error('[auth:invite] Failed to send invitation email', {
            error: err instanceof Error ? err.message : String(err),
            email,
            organizationId: org.id,
          })
          throw err
        }
      },
    }),
  ]

  const platformSecret = process.env.PLATFORM_HMAC_SECRET
  if (platformSecret) {
    plugins.push(
      platformAuth({
        hmacSecret: platformSecret,
        allowedEmailDomains: parseAllowedEmailDomains(),
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
    )
  }

  if (process.env.NODE_ENV !== 'production') plugins.push(devAuth())

  const allowedDomains = parseAllowedEmailDomains()

  // Auto-enroll new users so invited members land straight in /team. On
  // invitation accept we also mint a staff_profiles row so the invitee
  // shows up in the roster immediately.
  // biome-ignore lint/suspicious/noExplicitAny: drizzle scoped-db typing
  const dbAny = db as any

  const ensureStaffProfile = async (userId: string, organizationId: string): Promise<void> => {
    try {
      const { staffProfiles } = await import('@modules/team/schema')
      const [u] = await dbAny
        .select({ name: authUser.name, email: authUser.email })
        .from(authUser)
        .where(eq(authUser.id, userId))
        .limit(1)
      const displayName = u?.name ?? u?.email ?? null
      await dbAny
        .insert(staffProfiles)
        .values({ userId, organizationId, displayName })
        .onConflictDoNothing({ target: staffProfiles.userId })
    } catch (err) {
      logger.error('[auth] staff-profile ensure failed', {
        error: err instanceof Error ? err.message : String(err),
        userId,
        organizationId,
      })
    }
  }

  const autoEnroll = async (user: { id: string; email: string }): Promise<void> => {
    const [existing] = await dbAny
      .select({ id: authMember.id })
      .from(authMember)
      .where(eq(authMember.userId, user.id))
      .limit(1)
    if (existing) return

    const [invite] = await dbAny
      .select({
        id: authInvitation.id,
        organizationId: authInvitation.organizationId,
        role: authInvitation.role,
      })
      .from(authInvitation)
      .where(and(eq(authInvitation.email, user.email), eq(authInvitation.status, 'pending')))
      .limit(1)
    if (invite) {
      await dbAny.transaction(async (tx: typeof dbAny) => {
        await tx
          .insert(authMember)
          .values({
            id: createNanoid()(),
            userId: user.id,
            organizationId: invite.organizationId,
            role: invite.role,
          })
          .onConflictDoNothing({ target: [authMember.userId, authMember.organizationId] })
        await tx.update(authInvitation).set({ status: 'accepted' }).where(eq(authInvitation.id, invite.id))
      })
      logger.info(`[auth] Auto-accepted invitation for ${user.email}`)
      await ensureStaffProfile(user.id, invite.organizationId)
      return
    }

    if (multiOrg) return
    if (allowedDomains.length > 0) {
      const domain = user.email.split('@')[1]?.toLowerCase()
      if (!domain || !allowedDomains.map((d) => d.toLowerCase()).includes(domain)) return
    }
    const [soleOrg] = await dbAny.select({ id: authOrganization.id }).from(authOrganization).limit(1)
    if (!soleOrg) return
    const [firstMember] = await dbAny
      .select({ id: authMember.id })
      .from(authMember)
      .where(eq(authMember.organizationId, soleOrg.id))
      .limit(1)
    await dbAny
      .insert(authMember)
      .values({
        id: createNanoid()(),
        userId: user.id,
        organizationId: soleOrg.id,
        role: firstMember ? 'member' : 'owner',
      })
      .onConflictDoNothing({ target: [authMember.userId, authMember.organizationId] })
    logger.info(`[auth] Auto-enrolled ${user.email} into sole org as ${firstMember ? 'member' : 'owner'}`)
    await ensureStaffProfile(user.id, soleOrg.id)
  }

  return betterAuth({
    // biome-ignore lint/suspicious/noExplicitAny: drizzle-adapter accepts any drizzle instance
    database: drizzleAdapter(db as any, { provider: 'pg', schema: authTableMap }),
    emailAndPassword: { enabled: false },
    plugins,
    databaseHooks: {
      user: {
        create: {
          after: async (user) => {
            try {
              await autoEnroll({ id: user.id, email: user.email })
            } catch (err) {
              logger.error('[auth] auto-enroll failed', {
                error: err instanceof Error ? err.message : String(err),
                email: user.email,
              })
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
              const [m] = await dbAny
                .select({ organizationId: authMember.organizationId })
                .from(authMember)
                .where(eq(authMember.userId, session.userId))
                .limit(1)
              if (m && !session.activeOrganizationId) {
                return { data: { ...session, activeOrganizationId: m.organizationId } }
              }
            } catch (err) {
              logger.error('[auth] session-create auto-enroll failed', {
                error: err instanceof Error ? err.message : String(err),
                userId: session.userId,
              })
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
