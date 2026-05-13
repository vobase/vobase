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

/** Prefix every line with `> `. Shared between trigger renderers and `wake/unread-activity.ts`. */
export function blockquote(body: string): string {
  return body
    .split('\n')
    .map((line) => `> ${line}`)
    .join('\n')
}

/**
 * Render `body` as a markdown blockquote so the cue's provenance is unambiguous
 * when an LLM reads it. Trims, truncates with the cue-wide byte budget, and
 * blockquotes — mirrors `renderOperatorThread`'s handling of operator-thread posts.
 */
function quoteBody(body: string): string {
  return blockquote(truncateForCue(body))
}

function renderInboundMessage(trigger: WakeTrigger, refs: RenderRefs): string {
  if (trigger.trigger !== 'inbound_message') return ''
  const pointer = `See ${convoFolder(refs)}/MESSAGES.md for the full thread.`
  const body = trigger.body?.trim()
  if (!body) return `New customer message(s). ${pointer}`
  return `New customer message:\n\n${quoteBody(body)}\n\n${pointer}`
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
  const pointer = `Full thread in ${convoFolder(refs)}/INTERNAL-NOTES.md.`
  const noteSection = body
    ? `${lead} from staff:${trigger.authorUserId}:\n\n${quoteBody(body)}\n\n${pointer}`
    : `${lead}. Read ${convoFolder(refs)}/INTERNAL-NOTES.md for context.`
  const youOwn = refs.assignee === `agent:${refs.currentAgentId}`
  if (!youOwn) {
    return `${noteSection} You are NOT the conversation assignee — ${describeAssignee(refs.assignee)} owns this thread. Treat the @-mention as a peer consultation: read it, update memory if it teaches you a pattern, and end the turn. The customer-facing tools (reply / send_card / send_file / book_slot) are not available in this wake — the assignee owns customer replies.`
  }
  return `${noteSection} Act on this note's request only. Do not re-respond to prior customer threads — anything still pending was already handled in earlier wakes (your recent outbound appears below under "Your recent actions"). See \`## Staff note (this wake)\` in AGENTS.md for the routing table.`
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
  if (!body) {
    // Empty body shouldn't happen in practice (operator-thread handler always
    // reads the latest user message), but guard so the cue still parses.
    return 'A staff member posted in your operator thread, but the latest message is empty. Acknowledge politely and end the turn.'
  }
  return `A staff member posted in your operator thread:\n\n${quoteBody(body)}\n\nRespond or act on this now. If the message implies a write to a workspace file, use bash (or the matching CLI verb) — do not reply "logged for review" without actually performing the write.`
}

function renderHeartbeat(trigger: WakeTrigger, _refs: RenderRefs): string {
  if (trigger.trigger !== 'heartbeat') return ''
  return `Heartbeat (${trigger.reason}) at ${trigger.intendedRunAt.toISOString()}. Run your review-and-plan flow.`
}

function renderCaptionReady(trigger: WakeTrigger, refs: RenderRefs): string {
  if (trigger.trigger !== 'caption_ready') return ''
  const fileLabel = trigger.filePath ?? `file ${trigger.fileId}`
  const pointer = `Re-read ${convoFolder(refs)}/MESSAGES.md for the updated context.`
  const caption = trigger.caption?.trim()
  if (!caption) return `Caption ready for ${fileLabel}. ${pointer}`
  return `Caption ready for ${fileLabel}:\n\n${quoteBody(caption)}\n\n${pointer}`
}

function renderChangeDecided(trigger: WakeTrigger, _refs: RenderRefs): string {
  if (trigger.trigger !== 'change_decided') return ''
  const summary = trigger.summary?.trim() ? trigger.summary.trim() : 'a change you proposed'
  if (trigger.decision === 'approved') {
    return [
      `Staff just APPROVED ${summary}`,
      '',
      'You MUST send a fresh customer-facing reply on this wake using the `reply` tool (or `send_card` if a card is more appropriate). Even if you previously told the customer the change was "logged for review" or "pending", a confirmation message is required now that the change is actually applied — staff are watching this conversation for closure. Do not end the wake without sending one.',
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
}

export function resolveTriggerSpec(triggerKind: WakeTriggerKind): TriggerSpec {
  return REGISTRY[triggerKind]
}
