// Invitations service — list / resend / revoke pending org invitations.

import { productName } from '@auth/branding'
import { renderInvitationEmail } from '@auth/emails'
import { sendEmail } from '@auth/emails/sender'
import { authInvitation, authOrganization, authUser } from '@auth/schema'
import { logger, notFound } from '@vobase/core'
import { and, asc, eq, gt } from 'drizzle-orm'

import { type RealtimeService, type ScopedDb, safeNotify } from '~/runtime'

/** Default invitation TTL (matches better-auth's organization plugin default of 48h). */
const DEFAULT_INVITE_TTL_MS = 48 * 60 * 60 * 1000

export interface PendingInvitation {
  id: string
  email: string
  role: string | null
  phoneNumber: string | null
  inviterId: string
  inviterName: string | null
  inviterEmail: string | null
  expiresAt: Date
  createdAt: Date
}

interface InvitationsDeps {
  db: ScopedDb
  realtime: RealtimeService
}

export interface InvitationsService {
  list(organizationId: string): Promise<PendingInvitation[]>
  resend(organizationId: string, invitationId: string): Promise<void>
  revoke(organizationId: string, invitationId: string): Promise<void>
}

export function createInvitationsService(deps: InvitationsDeps): InvitationsService {
  const db = deps.db
  const realtime = deps.realtime

  const notify = (id: string, action: string) => safeNotify(realtime, { table: 'auth_invitation', id, action })

  async function list(organizationId: string): Promise<PendingInvitation[]> {
    const rows = (await db
      .select({
        id: authInvitation.id,
        email: authInvitation.email,
        role: authInvitation.role,
        phoneNumber: authInvitation.phoneNumber,
        inviterId: authInvitation.inviterId,
        inviterName: authUser.name,
        inviterEmail: authUser.email,
        expiresAt: authInvitation.expiresAt,
        createdAt: authInvitation.createdAt,
      })
      .from(authInvitation)
      .leftJoin(authUser, eq(authUser.id, authInvitation.inviterId))
      .where(
        and(
          eq(authInvitation.organizationId, organizationId),
          eq(authInvitation.status, 'pending'),
          gt(authInvitation.expiresAt, new Date()),
        ),
      )
      .orderBy(asc(authInvitation.createdAt))) as Array<{
      id: string
      email: string
      role: string | null
      phoneNumber: string | null
      inviterId: string
      inviterName: string | null
      inviterEmail: string | null
      expiresAt: Date
      createdAt: Date
    }>
    return rows
  }

  /** Resolve an invitation that is currently pending and belongs to this org. */
  async function loadPending(
    organizationId: string,
    invitationId: string,
  ): Promise<{
    id: string
    email: string
    status: string
    organizationId: string
    inviterId: string
  }> {
    const rows = (await db
      .select({
        id: authInvitation.id,
        email: authInvitation.email,
        status: authInvitation.status,
        organizationId: authInvitation.organizationId,
        inviterId: authInvitation.inviterId,
      })
      .from(authInvitation)
      .where(and(eq(authInvitation.id, invitationId), eq(authInvitation.organizationId, organizationId)))
      .limit(1)) as Array<{
      id: string
      email: string
      status: string
      organizationId: string
      inviterId: string
    }>
    const row = rows[0]
    if (!row) throw notFound('invitation')
    if (row.status !== 'pending') throw notFound('invitation')
    return row
  }

  async function resend(organizationId: string, invitationId: string): Promise<void> {
    const invite = await loadPending(organizationId, invitationId)

    const [[inviter], [org]] = await Promise.all([
      db
        .select({ name: authUser.name, email: authUser.email })
        .from(authUser)
        .where(eq(authUser.id, invite.inviterId))
        .limit(1) as Promise<Array<{ name: string | null; email: string | null }>>,
      db
        .select({ name: authOrganization.name })
        .from(authOrganization)
        .where(eq(authOrganization.id, organizationId))
        .limit(1) as Promise<Array<{ name: string | null }>>,
    ])

    const baseUrl = process.env.BETTER_AUTH_URL || 'http://localhost:5173'
    const signInUrl = `${baseUrl}/auth/login?invitationId=${encodeURIComponent(invitationId)}`
    const orgName = org?.name ?? 'your organization'
    const inviterName = inviter?.name ?? inviter?.email ?? 'A teammate'

    const html = await renderInvitationEmail({
      inviterName,
      organizationName: orgName,
      signInUrl,
    })

    try {
      await sendEmail({
        to: invite.email,
        subject: `[${productName}] You've been invited to ${orgName}`,
        html,
      })
    } catch (err) {
      logger.error(
        {
          error: err instanceof Error ? err.message : String(err),
          email: invite.email,
          invitationId,
        },
        '[team/invitations] resend email failed',
      )
      throw err
    }

    // Push the expiry forward so the invitee has the full TTL again. The row
    // already counts as "freshly sent" once the email is on the wire — we update
    // even on partial failure paths only after the send succeeds.
    const newExpiresAt = new Date(Date.now() + DEFAULT_INVITE_TTL_MS)
    await db.update(authInvitation).set({ expiresAt: newExpiresAt }).where(eq(authInvitation.id, invitationId))

    notify(invitationId, 'resent')
  }

  async function revoke(organizationId: string, invitationId: string): Promise<void> {
    const invite = await loadPending(organizationId, invitationId)
    await db.update(authInvitation).set({ status: 'canceled' }).where(eq(authInvitation.id, invite.id))
    notify(invitationId, 'revoked')
  }

  return { list, resend, revoke }
}

let _current: InvitationsService | null = null

export function installInvitationsService(svc: InvitationsService): void {
  _current = svc
}

export function __resetInvitationsServiceForTests(): void {
  _current = null
}

function current(): InvitationsService {
  if (!_current) {
    throw new Error('team/invitations: service not installed — call installInvitationsService() in module init')
  }
  return _current
}

export function listPending(organizationId: string): Promise<PendingInvitation[]> {
  return current().list(organizationId)
}
export function resendInvitation(organizationId: string, invitationId: string): Promise<void> {
  return current().resend(organizationId, invitationId)
}
export function revokeInvitation(organizationId: string, invitationId: string): Promise<void> {
  return current().revoke(organizationId, invitationId)
}
