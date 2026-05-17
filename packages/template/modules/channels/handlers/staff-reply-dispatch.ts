/**
 * Staff-reply branch of the registry-driven inbound router.
 *
 * Two sub-branches:
 *   A. ask-staff-answer — `claimPing` resolves the inbound to a single pending
 *      mention ping (exact `context.id` wamid match, or the staff member's sole
 *      live ping). Appends a staff-authored internal note carrying
 *      `mentions: ['agent:<askingAgentId>']`; the existing `addNote` post-commit
 *      fan-out enqueues a wake for the asking agent.
 *   B. operator-thread — no single ping resolved: enqueue/append into the
 *      operator chat thread for the org's default operator agent (per-org
 *      default via `getOrgSetting('defaultOperatorAgentId')`, fallback to oldest
 *      enabled agent). When the claim was `ambiguous` (the staff member has ≥2
 *      live pings and didn't quote one), a `system` message is appended telling
 *      the operator agent the reply could not be auto-routed.
 *
 * Pulled out of `inbound-router.ts` so the router stays under 150 LOC and
 * adding a third sub-branch (e.g. command-mode or unknown-staff handling)
 * doesn't grow the router file.
 */

import { authUser } from '@auth/schema'
import { agentDefinitions, operatorThreads } from '@modules/agents/schema'
import { requireJobs } from '@modules/agents/service/state'
import { threads as threadsApi } from '@modules/agents/service/threads'
import { addNote } from '@modules/messaging/service/notes'
import { getOrgSetting } from '@modules/settings/service/org-settings'
import { staffProfiles } from '@modules/team/schema'
import { claimPing } from '@modules/team/service/pending-staff-pings'
import { logger } from '@vobase/core'
import { and, asc, desc, eq } from 'drizzle-orm'

import type { ScopedDb } from '~/runtime'
import { OPERATOR_THREAD_TO_WAKE_JOB } from '~/wake/operator-thread'

interface MetaInboundMessage {
  from?: string
  type?: string
  id?: string
  text?: { body?: string }
  /** Present only when the sender used WhatsApp's native reply gesture; `id` is the quoted message's wamid. */
  context?: { id?: string }
}

export interface MetaInbound {
  object?: string
  entry?: Array<{
    changes?: Array<{
      value?: {
        metadata?: { phone_number_id?: string }
        messages?: MetaInboundMessage[]
      }
    }>
  }>
}

export interface StaffReplyInput {
  db: ScopedDb
  organizationId: string
  payload: MetaInbound
}

export interface StaffReplyResult {
  ok: true
  branch:
    | 'unparseable'
    | 'unmatched_staff'
    | 'ask_staff_answer'
    | 'operator_thread'
    | 'operator_thread_ambiguous'
    | 'no_enabled_agent'
  threadId?: string
  agentId?: string
  warning?: string
}

/** Operator-agent-facing note when a reply couldn't be auto-routed to a consult. */
function buildAmbiguousReplyHint(liveCount: number): string {
  return (
    `Heads up: this teammate has ${liveCount} open questions from agents waiting on a reply, and this message arrived ` +
    'without quoting a specific one — so it could not be routed back to a conversation automatically. If it reads like ' +
    'an answer to one of those, ask which customer or conversation they mean before relaying it. They can also ' +
    'long-press a question in WhatsApp and reply to it directly so future answers route on their own.'
  )
}

export async function dispatchStaffReply(input: StaffReplyInput): Promise<StaffReplyResult> {
  const { db, organizationId, payload } = input
  const messages = payload.entry?.[0]?.changes?.[0]?.value?.messages ?? []
  const msg = messages.find((m) => m.type === 'text' && m.text?.body)
  if (!msg) return { ok: true, branch: 'unparseable' } // status-update or non-text

  const senderPhone = msg.from
  const text = msg.text?.body?.trim()
  if (!senderPhone || !text) return { ok: true, branch: 'unparseable' }

  // Match either with or without leading `+` — Meta's wa_id has no `+`; we
  // store `+E.164` on the better-auth `user` row.
  const candidate = senderPhone.startsWith('+') ? senderPhone : `+${senderPhone}`
  const [staff] = await db
    .select({ userId: staffProfiles.userId })
    .from(staffProfiles)
    .innerJoin(authUser, eq(authUser.id, staffProfiles.userId))
    .where(and(eq(staffProfiles.organizationId, organizationId), eq(authUser.phoneNumber, candidate)))
    .limit(1)
  if (!staff) return { ok: true, branch: 'unmatched_staff' }

  // ─── Branch A — ask-staff-answer ─────────────────────────────────────────
  // Ladder: exact `context.id` wamid match → the staff member's sole live ping.
  const claim = await claimPing({
    staffUserId: staff.userId,
    organizationId,
    outboundWamid: msg.context?.id,
  })
  if (claim.status === 'claimed') {
    const { ping } = claim
    try {
      await addNote({
        organizationId,
        conversationId: ping.conversationId,
        author: { kind: 'staff', id: staff.userId },
        body: text,
        mentions: [`agent:${ping.askingAgentId}`],
        parentNoteId: ping.originalNoteId,
      })
      return { ok: true, branch: 'ask_staff_answer' }
    } catch (err) {
      logger.warn({ err }, '[inbound-router] ask_staff_answer addNote failed')
      return { ok: true, branch: 'ask_staff_answer', warning: 'addNote_failed' }
    }
  }

  // ─── Branch B — operator-thread ──────────────────────────────────────────
  // Reached when the claim was `none` (a fresh staff-initiated message) or
  // `ambiguous` (≥2 live pings, no quoted wamid — we refuse to guess which
  // conversation the reply answers; the operator agent gets a `system` hint).
  const ambiguousCount = claim.status === 'ambiguous' ? claim.liveCount : null
  let agentId: string | null = await getOrgSetting(organizationId, 'defaultOperatorAgentId')
  if (!agentId) {
    const [first] = await db
      .select({ id: agentDefinitions.id })
      .from(agentDefinitions)
      .where(and(eq(agentDefinitions.organizationId, organizationId), eq(agentDefinitions.enabled, true)))
      .orderBy(asc(agentDefinitions.createdAt))
      .limit(1)
    agentId = first?.id ?? null
  }
  if (!agentId) return { ok: true, branch: 'no_enabled_agent' }

  const [existingThread] = await db
    .select({ id: operatorThreads.id, agentId: operatorThreads.agentId })
    .from(operatorThreads)
    .where(
      and(
        eq(operatorThreads.organizationId, organizationId),
        eq(operatorThreads.createdBy, staff.userId),
        eq(operatorThreads.status, 'open'),
      ),
    )
    .orderBy(desc(operatorThreads.updatedAt))
    .limit(1)

  let threadId: string
  let threadAgentId: string
  if (existingThread) {
    threadId = existingThread.id
    threadAgentId = existingThread.agentId
    await threadsApi.appendMessage({ threadId, role: 'user', content: text })
  } else {
    const created = await threadsApi.createThread({
      organizationId,
      agentId,
      createdBy: staff.userId,
      title: 'WhatsApp thread',
      firstMessage: { role: 'user', content: text },
    })
    threadId = created.threadId
    threadAgentId = agentId
  }

  if (ambiguousCount !== null) {
    await threadsApi.appendMessage({
      threadId,
      role: 'system',
      content: buildAmbiguousReplyHint(ambiguousCount),
    })
  }

  await requireJobs().send(
    OPERATOR_THREAD_TO_WAKE_JOB,
    { organizationId, threadId },
    { singletonKey: `operator-thread:${threadId}` },
  )

  return {
    ok: true,
    branch: ambiguousCount === null ? 'operator_thread' : 'operator_thread_ambiguous',
    threadId,
    agentId: threadAgentId,
  }
}
