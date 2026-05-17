/**
 * Staff-reply branch of the registry-driven inbound router.
 *
 * Sub-branches (in order):
 *   0. decision-route (US-009 / Slice B.4) — the inbound is either a button tap
 *      (`interactive.button_reply` with `id = 'approve:<refId>' | 'deny:<refId>'`)
 *      OR a free-text reply starting with `approve` / `deny` / `yes` / `no` /
 *      ✅ / ❌. When a live ping resolves AND the claimed ping's `kind` is
 *      `'approval'` or `'proposal'`, we route through `resolveReply` which
 *      calls `pendingApprovals.decide` / `proposals.decideChangeProposal`.
 *      The decide path emits `approval_decided` / `proposal_decided`
 *      (US-008), so the wake chain fires automatically — no separate addNote.
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
import { matchButtonPayload } from '@modules/team/service/button-payload-matcher'
import { claimPing } from '@modules/team/service/pending-staff-pings'
import { parseReplyText } from '@modules/team/service/reply-parser'
import { type PingKind, resolveReply } from '@modules/team/service/staff-ping'
import { logger } from '@vobase/core'
import { and, asc, desc, eq } from 'drizzle-orm'

import type { ScopedDb } from '~/runtime'
import { OPERATOR_THREAD_TO_WAKE_JOB } from '~/wake/operator-thread'

interface MetaInboundMessage {
  from?: string
  type?: string
  id?: string
  text?: { body?: string }
  /**
   * Interactive payload — present when the staff member taps a button on a
   * `vobase_approval_decision` / `vobase_proposal_decision` template
   * (Slice C / US-011). The Slice B.4 inbound matcher recognises the shape
   * already so the wiring is ready when the templates ship.
   */
  interactive?: { button_reply?: { id?: string; title?: string }; type?: string }
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
    | 'decision_routed'
    | 'ask_staff_answer'
    | 'operator_thread'
    | 'operator_thread_ambiguous'
    | 'no_enabled_agent'
  threadId?: string
  agentId?: string
  warning?: string
  decisionKind?: PingKind
  decision?: 'approve' | 'deny'
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
  // Pick the first inbound that's either a text body OR an interactive
  // button reply — both shapes carry an approve/deny signal in Slice B.4.
  const msg = messages.find(
    (m) => (m.type === 'text' && m.text?.body) || (m.type === 'interactive' && m.interactive?.button_reply?.id),
  )
  if (!msg) return { ok: true, branch: 'unparseable' } // status-update or non-text/non-interactive

  const senderPhone = msg.from
  if (!senderPhone) return { ok: true, branch: 'unparseable' }

  const buttonMatch = msg.interactive?.button_reply ? matchButtonPayload(msg.interactive.button_reply) : null
  const text = msg.text?.body?.trim()
  if (!buttonMatch && !text) return { ok: true, branch: 'unparseable' }

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
  // (Buttons don't carry `context.id`; rely on the sole-live-ping rung.)
  const claim = await claimPing({
    staffUserId: staff.userId,
    organizationId,
    outboundWamid: msg.context?.id,
  })

  // ─── Branch 0 — decision-route (US-009 / Slice B.4) ──────────────────────
  // Triggered when (a) the inbound carries a decision signal (button match or
  // approve/deny verb) AND (b) a single live ping resolved AND (c) that ping's
  // `kind` is 'approval' or 'proposal'. Mention pings fall through to Branch A
  // because the agent wake happens via the staff-note fan-out, not a direct
  // decide() call.
  if (claim.status === 'claimed' && (claim.ping.kind === 'approval' || claim.ping.kind === 'proposal')) {
    const parsed = buttonMatch
      ? { decision: buttonMatch.decision, note: undefined as string | undefined, referenceId: buttonMatch.referenceId }
      : text
        ? { ...parseReplyText(text), referenceId: claim.ping.referenceId ?? claim.ping.originalNoteId }
        : null
    if (parsed && parsed.decision !== 'unknown') {
      try {
        await resolveReply(
          claim.ping.kind as PingKind,
          { decision: parsed.decision, note: parsed.note, referenceId: parsed.referenceId },
          { staffUserId: staff.userId, conversationId: claim.ping.conversationId, organizationId },
        )
        return {
          ok: true,
          branch: 'decision_routed',
          decisionKind: claim.ping.kind as PingKind,
          decision: parsed.decision,
        }
      } catch (err) {
        logger.warn({ err }, '[inbound-router] decision_route resolveReply failed')
        // Fall through to operator-thread so the staff reply isn't lost.
      }
    }
  }

  // Button payloads that arrive without a live ping (Slice C templates from a
  // pre-claim-expired or already-claimed prior session) fall through to the
  // operator-thread branch — the staff still gets a sane handling and the
  // operator agent can route manually. A future Slice C+ revision could add
  // a kind-probe via direct table lookup when proposals.service exports a
  // `get(id)` method (today it doesn't); for now the kind is only known via
  // a live `pending_staff_pings` row.

  if (claim.status === 'claimed') {
    const { ping } = claim
    try {
      await addNote({
        organizationId,
        conversationId: ping.conversationId,
        author: { kind: 'staff', id: staff.userId },
        body: text ?? '',
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

  // Button-only inbounds (interactive without text) get a synthesised body so
  // the operator agent has SOMETHING to read. The button's `title` (e.g.
  // "Approve" / "Deny") is more informative than a bare id.
  const operatorThreadBody =
    text ?? `[button] ${msg.interactive?.button_reply?.title ?? msg.interactive?.button_reply?.id ?? 'unknown'}`

  let threadId: string
  let threadAgentId: string
  if (existingThread) {
    threadId = existingThread.id
    threadAgentId = existingThread.agentId
    await threadsApi.appendMessage({ threadId, role: 'user', content: operatorThreadBody })
  } else {
    const created = await threadsApi.createThread({
      organizationId,
      agentId,
      createdBy: staff.userId,
      title: 'WhatsApp thread',
      firstMessage: { role: 'user', content: operatorThreadBody },
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
