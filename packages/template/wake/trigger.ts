/**
 * Per-trigger spec registry.
 *
 * Each `WakeTriggerKind` is one row declaring everything that varies by wake
 * reason: which lane the wake belongs to (`conversation` vs `standalone`),
 * the log prefix, and the trigger renderer that builds the wake-reason cue
 * placed at the top of the first user-turn message.
 *
 * The lane catalogue is computed by the wake builders by filtering
 * `AgentContributions.tools` on each tool's `lane` field — adding a new
 * conversation/standalone tool is a one-line edit in its owning module's
 * `agent.ts`, not a registry change here.
 *
 * Frozen-snapshot rule: every field is a pure function of `(triggerKind,
 * trigger payload, refs)`. The renderers must be deterministic across
 * retries — no DB reads, no clock — so the `systemHash` derived downstream is
 * byte-stable.
 */

import { humanBytes } from '@modules/drive/lib/format'
import {
  blockquoteBody,
  conversationRow,
  messageAudienceLabel,
  noteAudienceLabel,
} from '@modules/messaging/lib/conversation-row'

import type { WakeTrigger, WakeTriggerKind } from './events'

/**
 * Wake-context handles the renderer needs. All fields optional because
 * standalone-lane wakes (operator-thread, heartbeat) have no conversation
 * context to thread through. Each renderer reads only the fields its trigger
 * variant depends on.
 */
export interface RenderRefs {
  contactId?: string
  channelInstanceId?: string
  assignee?: string
  currentAgentId?: string
}

export interface TriggerSpec {
  lane: 'conversation' | 'standalone'
  /** Log prefix used by buildSseListener and console traces. */
  logPrefix: 'wake:conv' | 'wake:solo'
  /** Render the wake-reason cue prepended to the first user-turn message. */
  render: (trigger: WakeTrigger, refs: RenderRefs) => string
}

// ─── Renderers ─────────────────────────────────────────────────────────────

function convoFolder(refs: RenderRefs): string {
  return `/contacts/${refs.contactId}/${refs.channelInstanceId}`
}

/**
 * Hard cap on the inlined body bytes in a wake cue. Keeps pg-boss payloads and
 * the rendered user-turn message bounded even for pathological note bodies or
 * captions. Sized to match the harness's 4KB inline tool-stdout budget so
 * agents see the same cap everywhere. The full content is always still
 * available via the cue's "full thread in …" pointer.
 */
const MAX_CUE_BODY_BYTES = 4096
const TRUNCATION_MARKER = '\n…[truncated — see the full thread in the file pointer below]'
const TRUNCATION_MARKER_BYTES = Buffer.byteLength(TRUNCATION_MARKER, 'utf8')

/** Trim `body` to ≤ maxBytes (UTF-8 including the marker), cutting on a line boundary when possible. */
export function truncateForCue(body: string, maxBytes = MAX_CUE_BODY_BYTES): string {
  const trimmed = body.trim()
  if (Buffer.byteLength(trimmed, 'utf8') <= maxBytes) return trimmed
  // Reserve room for the marker so the returned string is guaranteed ≤ maxBytes.
  const budget = maxBytes - TRUNCATION_MARKER_BYTES
  const lines = trimmed.split('\n')
  const kept: string[] = []
  let bytes = 0
  for (const line of lines) {
    const lineBytes = Buffer.byteLength(line, 'utf8')
    // First line costs just its bytes; subsequent lines add a separator newline (matches `kept.join('\n')` size).
    const needed = bytes === 0 ? lineBytes : bytes + 1 + lineBytes
    if (needed > budget) break
    kept.push(line)
    bytes = needed
  }
  // No line fit: hard byte slice on the first line so the agent still sees something meaningful.
  if (kept.length === 0) {
    const buf = Buffer.from(trimmed, 'utf8').subarray(0, budget)
    return `${buf.toString('utf8')}${TRUNCATION_MARKER}`
  }
  return `${kept.join('\n')}${TRUNCATION_MARKER}`
}

/**
 * Render `body` as a markdown blockquote so the cue's provenance is unambiguous
 * when an LLM reads it. Trims, truncates with the cue-wide byte budget, and
 * blockquotes — mirrors `renderOperatorThread`'s handling of operator-thread posts.
 */
function quoteBody(body: string): string {
  return blockquoteBody(truncateForCue(body))
}

function renderInboundAttachments(
  attachments: ReadonlyArray<{ path: string; mimeType: string; sizeBytes: number }> | undefined,
): string {
  if (!attachments || attachments.length === 0) return ''
  // Cap at the first 5 attachments so a runaway "20 image album" inbound
  // can't blow the cue budget. The agent can still see the full set under
  // CONVERSATION.md.
  const shown = attachments.slice(0, 5)
  const extra = attachments.length - shown.length
  const lines = shown.map((a) => `- [attached: ${a.path} (${a.mimeType}, ${humanBytes(a.sizeBytes)})]`)
  if (extra > 0) lines.push(`- …and ${extra} more attachment${extra === 1 ? '' : 's'} (see CONVERSATION.md).`)
  return `\n\nAttached:\n${lines.join('\n')}\n\nUse \`send_file --driveFileId=<path>\` to forward an attachment back to the customer, or \`request_caption\` for richer extraction on a binary stub.`
}

function renderInboundMessage(trigger: WakeTrigger, refs: RenderRefs): string {
  if (trigger.trigger !== 'inbound_message') return ''
  const pointer = `See ${convoFolder(refs)}/CONVERSATION.md for the full thread.`
  const attachmentsBlock = renderInboundAttachments(trigger.attachments)
  const body = trigger.body?.trim()
  if (!body) {
    if (attachmentsBlock) {
      return `New customer message(s).${attachmentsBlock}\n\n${pointer}`
    }
    return `New customer message(s). ${pointer}`
  }
  const row = conversationRow({ label: messageAudienceLabel('customer'), body: truncateForCue(body) })
  return `New customer message:\n\n${row}${attachmentsBlock}\n\n${pointer}`
}

function renderApprovalResumed(trigger: WakeTrigger, _refs: RenderRefs): string {
  if (trigger.trigger !== 'approval_resumed') return ''
  return trigger.decision === 'approved'
    ? 'Your previous action was approved. Continue.'
    : `Your previous action was rejected: ${trigger.note ?? '(no note)'}. Choose a different approach.`
}

function describeAssignee(assignee: string | undefined): string {
  if (!assignee) return 'someone else ((unknown))'
  if (assignee.startsWith('user:')) return `staff member ${assignee}`
  if (assignee.startsWith('agent:')) return `another agent (${assignee})`
  return `someone else (${assignee})`
}

function renderStaffNote(trigger: WakeTrigger, refs: RenderRefs): string {
  if (trigger.trigger !== 'staff_note') return ''
  const lead = trigger.mentionedAgentId ? `Staff @-mentioned you in an internal note` : `Staff added an internal note`
  const body = trigger.body?.trim()
  const pointer = `Full thread in ${convoFolder(refs)}/CONVERSATION.md.`
  const noteRow = body
    ? conversationRow({ label: noteAudienceLabel('staff', trigger.authorUserId), body: truncateForCue(body) })
    : ''
  const noteSection = body
    ? `${lead}:\n\n${noteRow}\n\n${pointer}`
    : `${lead}. Read ${convoFolder(refs)}/CONVERSATION.md for context.`
  const youOwn = refs.assignee === `agent:${refs.currentAgentId}`
  const ownership = youOwn
    ? `You are the conversation assignee.`
    : `You are NOT the conversation assignee — ${describeAssignee(refs.assignee)} owns this thread.`
  return `${noteSection} ${ownership} Decide what the note asks for. If it tells you to message the customer — or it answers a question you raised with staff on the customer's behalf — send that to the customer now with \`reply_contact\` (or \`send_card\`). If it is pure internal coaching, act on it via memory updates, contact proposals, or a workspace write. Either way, close the loop with the note author using \`consult_staff\`. See \`## Staff note (this wake)\` in AGENTS.md for the routing table.`
}

function renderScheduledFollowup(trigger: WakeTrigger, _refs: RenderRefs): string {
  if (trigger.trigger !== 'scheduled_followup') return ''
  return `Scheduled follow-up: ${trigger.reason}.`
}

function renderManual(trigger: WakeTrigger, _refs: RenderRefs): string {
  if (trigger.trigger !== 'manual') return ''
  return `Manual wake: ${trigger.reason}.`
}

function renderOperatorThread(trigger: WakeTrigger, _refs: RenderRefs): string {
  if (trigger.trigger !== 'operator_thread') return ''
  const body = trigger.threadMessage.trim()
  // The user turn is kept to the BARE staff message. It is persisted to
  // `agent_messages` and replayed as conversation history on every later
  // wake, so it must read as a plain chat line. Wrapping each turn in
  // "respond now" / "reply to exactly this" imperatives made the agent see N
  // competing instructions in the replayed history and answer an older turn
  // (the off-by-one bug). All per-wake framing now lives in the operator
  // brief side-load, which is attached to the current turn only — see
  // `renderStandaloneBrief` in `wake/standalone.ts`.
  if (!body) return '(The staff member sent an empty message.)'
  return truncateForCue(body)
}

function renderHeartbeat(trigger: WakeTrigger, _refs: RenderRefs): string {
  if (trigger.trigger !== 'heartbeat') return ''
  return `Heartbeat (${trigger.reason}) at ${trigger.intendedRunAt.toISOString()}. Run your review-and-plan flow.`
}

function renderCaptionReady(trigger: WakeTrigger, refs: RenderRefs): string {
  if (trigger.trigger !== 'caption_ready') return ''
  const fileLabel = trigger.filePath ?? `file ${trigger.fileId}`
  const pointer = `Re-read ${convoFolder(refs)}/CONVERSATION.md for the updated context.`
  const caption = trigger.caption?.trim()
  if (!caption) return `Caption ready for ${fileLabel}. ${pointer}`
  return `Caption ready for ${fileLabel}:\n\n${quoteBody(caption)}\n\n${pointer}`
}

function renderConversationReassigned(trigger: WakeTrigger, refs: RenderRefs): string {
  if (trigger.trigger !== 'conversation_reassigned') return ''
  const from = trigger.fromAssignee ?? '(unassigned)'
  const reasonPart = trigger.reason ? `Reason: ${trigger.reason}. ` : ''
  return `Conversation reassigned from ${from} to ${trigger.toAssignee}. ${reasonPart}Acknowledge in your operator thread and continue handling. See ${convoFolder(refs)}/CONVERSATION.md for context.`
}

function renderApprovalFiled(trigger: WakeTrigger, _refs: RenderRefs): string {
  if (trigger.trigger !== 'approval_filed') return ''
  return `You have a new pending approval: ${trigger.approvalSummary}. Decide via the operator thread or wait for staff resolution.`
}

function renderApprovalDecided(trigger: WakeTrigger, _refs: RenderRefs): string {
  if (trigger.trigger !== 'approval_decided') return ''
  const notePart = trigger.note ? `: ${trigger.note}` : ''
  return `Your approval ${trigger.approvalId} was ${trigger.decision} by ${trigger.decidedByLabel}${notePart}. Update your operator-thread record.`
}

function renderProposalFiled(trigger: WakeTrigger, _refs: RenderRefs): string {
  if (trigger.trigger !== 'proposal_filed') return ''
  return `A new change proposal was filed: ${trigger.proposalSummary} (${trigger.resourceModule}/${trigger.resourceType}). Awaiting staff decision.`
}

function renderProposalDecided(trigger: WakeTrigger, _refs: RenderRefs): string {
  if (trigger.trigger !== 'proposal_decided') return ''
  const notePart = trigger.note ? `: ${trigger.note}` : ''
  if (trigger.conversationId !== null) {
    return `Your proposal ${trigger.proposalId} was ${trigger.decision}${notePart}. Reply to the customer if appropriate.`
  }
  return `Your proposal ${trigger.proposalId} was ${trigger.decision}${notePart}.`
}

function renderChangeDecided(trigger: WakeTrigger, _refs: RenderRefs): string {
  if (trigger.trigger !== 'change_decided') return ''
  const summary = trigger.summary?.trim() ? trigger.summary.trim() : 'a change you proposed'
  if (trigger.decision === 'approved') {
    return [
      `Staff just APPROVED ${summary}`,
      '',
      'You MUST send a fresh customer-facing reply on this wake using the `reply_contact` tool (or `send_card` if a card is more appropriate). Even if you previously told the customer the change was "logged for review" or "pending", a confirmation message is required now that the change is actually applied — staff are watching this conversation for closure. Do not end the wake without sending one.',
      '',
      'Keep the reply brief (one or two sentences). Do NOT re-list the fields the customer asked about; they remember. Example phrasing: "All set — your update is live now. Let me know if there\'s anything else."',
      '',
      'Do NOT send another `add_note` and do NOT re-attempt any write — the change is already in the database. Reply, then end the wake.',
    ].join('\n')
  }
  // Rejected branch.
  const noteLine = trigger.decidedNote?.trim()
    ? `Staff note (verbatim, for your understanding only — do NOT quote it to the customer unless they ask): "${trigger.decidedNote.trim()}"`
    : 'No staff note was attached.'
  return [
    `Staff just DECLINED ${summary}`,
    '',
    noteLine,
    '',
    'Acknowledge politely to the customer that the change could not be made on this channel. Suggest a constructive next step IF the staff note hints at one (e.g. "ask IT to email the request from your corporate mailbox"); otherwise just say our team will follow up. Keep it under two sentences. Do NOT re-attempt the write — the proposal is decided.',
  ].join('\n')
}

// ─── Registry ──────────────────────────────────────────────────────────────

const REGISTRY: Record<WakeTriggerKind, TriggerSpec> = {
  inbound_message: { lane: 'conversation', logPrefix: 'wake:conv', render: renderInboundMessage },
  approval_resumed: { lane: 'conversation', logPrefix: 'wake:conv', render: renderApprovalResumed },
  staff_note: { lane: 'conversation', logPrefix: 'wake:conv', render: renderStaffNote },
  scheduled_followup: { lane: 'conversation', logPrefix: 'wake:conv', render: renderScheduledFollowup },
  manual: { lane: 'conversation', logPrefix: 'wake:conv', render: renderManual },
  operator_thread: { lane: 'standalone', logPrefix: 'wake:solo', render: renderOperatorThread },
  heartbeat: { lane: 'standalone', logPrefix: 'wake:solo', render: renderHeartbeat },
  caption_ready: { lane: 'conversation', logPrefix: 'wake:conv', render: renderCaptionReady },
  change_decided: { lane: 'conversation', logPrefix: 'wake:conv', render: renderChangeDecided },
  // US-006: 5 new trigger kinds. Routing fields (toAssignee, filedByAgentId, proposedByAgentId)
  // are carried in the payload so the operator-thread dispatcher (US-013) can resolve the
  // wake target purely from the trigger without additional DB lookups.
  conversation_reassigned: { lane: 'conversation', logPrefix: 'wake:conv', render: renderConversationReassigned },
  approval_filed: { lane: 'standalone', logPrefix: 'wake:solo', render: renderApprovalFiled },
  approval_decided: { lane: 'standalone', logPrefix: 'wake:solo', render: renderApprovalDecided },
  proposal_filed: { lane: 'standalone', logPrefix: 'wake:solo', render: renderProposalFiled },
  // proposal_decided: lane is 'conversation' (static label); renderer branches on conversationId == null
  // to produce the standalone-variant cue text. Lane-filtering on tools is independent of this label.
  proposal_decided: { lane: 'conversation', logPrefix: 'wake:conv', render: renderProposalDecided },
}

export function resolveTriggerSpec(triggerKind: WakeTriggerKind): TriggerSpec {
  return REGISTRY[triggerKind]
}
