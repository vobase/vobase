/**
 * Staff-reply branch of the registry-driven inbound router.
 *
 * Two sub-branches:
 *   A. ask-staff-answer — if `pending_mention_pings` has a live row for
 *      `(staffUserId, organizationId)`, append a staff-authored internal
 *      note carrying `mentions: ['agent:<askingAgentId>']`. The existing
 *      `addNote` post-commit fan-out enqueues a wake for the asking agent.
 *   B. operator-thread — no live ping: enqueue/append into the operator
 *      chat thread for the org's default operator agent (per-org default
 *      via `getOrgSetting('defaultOperatorAgentId')`, fallback to oldest
 *      enabled agent).
 *
 * Pulled out of `inbound-router.ts` so the router stays under 150 LOC and
 * adding a third sub-branch (e.g. command-mode or unknown-staff handling)
 * doesn't grow the router file.
 */

import { agentDefinitions, operatorThreads } from '@modules/agents/schema'
import { requireJobs } from '@modules/agents/service/state'
import { threads as threadsApi } from '@modules/agents/service/threads'
import { addNote } from '@modules/messaging/service/notes'
import { getOrgSetting } from '@modules/settings/service/org-settings'
import { staffProfiles } from '@modules/team/schema'
import { claimPing } from '@modules/team/service/pending-mention-pings'
import { logger } from '@vobase/core'
import { and, asc, desc, eq } from 'drizzle-orm'

import type { ScopedDb } from '~/runtime'
import { OPERATOR_THREAD_TO_WAKE_JOB } from '~/wake/operator-thread'

interface MetaInboundMessage {
  from?: string
  type?: string
  id?: string
  text?: { body?: string }
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
  branch: 'unparseable' | 'unmatched_staff' | 'ask_staff_answer' | 'operator_thread' | 'no_enabled_agent'
  threadId?: string
  agentId?: string
  warning?: string
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
  // store `+E.164` in staff_profiles.
  const candidate = senderPhone.startsWith('+') ? senderPhone : `+${senderPhone}`
  const [staff] = await db
    .select({ userId: staffProfiles.userId })
    .from(staffProfiles)
    .where(and(eq(staffProfiles.organizationId, organizationId), eq(staffProfiles.whatsappPhoneE164, candidate)))
    .limit(1)
  if (!staff) return { ok: true, branch: 'unmatched_staff' }

  // ─── Branch A — ask-staff-answer ─────────────────────────────────────────
  const ping = await claimPing({ staffUserId: staff.userId, organizationId })
  if (ping) {
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

  await requireJobs().send(
    OPERATOR_THREAD_TO_WAKE_JOB,
    { organizationId, threadId },
    { singletonKey: `operator-thread:${threadId}` },
  )

  return { ok: true, branch: 'operator_thread', threadId, agentId: threadAgentId }
}
