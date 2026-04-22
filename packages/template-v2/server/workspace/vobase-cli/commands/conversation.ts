/**
 * `vobase conv …` CLI verbs for the current conversation.
 *
 * Both verbs are mutations executed against the inbox service:
 *   - `conv reassign` → `modules/inbox/service/conversations::reassign` (agent
 *     hands the conversation off; subsequent inbounds won't wake the agent if
 *     the new assignee isn't `agent:*`).
 *   - `conv ask-staff` → `modules/inbox/service/notes::addNote` with mentions,
 *     which fans out via the `@-mention` pipeline: staff gets a WA ping, their
 *     reply fires a `supervisor` wake trigger that re-wakes this agent with
 *     the note body in context.
 *
 * Usage:
 *   vobase conv reassign --to=<assignee> [--reason="..."]
 *     assignee = user:<id> | agent:<id> | unassigned
 *   vobase conv ask-staff --mention=<userId>[,<userId>...] --body="..."
 */

import { reassign as reassignConversation } from '@modules/inbox/service/conversations'
import { addNote } from '@modules/inbox/service/notes'
import { list as listStaff } from '@modules/team/service/staff'
import type { CommandDef } from '@server/contracts/plugin-context'

function parseFlags(argv: readonly string[]): Record<string, string> {
  const flags: Record<string, string> = {}
  for (const arg of argv) {
    const m = arg.match(/^--([^=]+)=(.*)$/s)
    if (m) flags[m[1]] = m[2]
  }
  return flags
}

function parseAssignee(v: string): { kind: 'user' | 'agent' | 'unassigned'; id: string } | null {
  if (v === 'unassigned') return { kind: 'unassigned', id: '' }
  const user = v.match(/^user:([^\s]+)$/)
  if (user) return { kind: 'user', id: user[1] }
  const agent = v.match(/^agent:([^\s]+)$/)
  if (agent) return { kind: 'agent', id: agent[1] }
  return null
}

export const conversationVerbs: readonly CommandDef[] = [
  {
    name: 'conv reassign',
    description:
      'Hand this conversation off to a different assignee. Use user:<id> to escalate to a human; the agent will stop replying until reassigned back.',
    usage: 'vobase conv reassign --to=<user:<id>|agent:<id>|unassigned> [--reason="..."]',

    async execute(argv, ctx) {
      const flags = parseFlags(argv)
      const to = flags.to
      if (!to) return { ok: false, error: 'missing required flag --to' }
      const parsed = parseAssignee(to)
      if (!parsed) {
        return {
          ok: false,
          error: `--to must be "user:<id>", "agent:<id>", or "unassigned" (got ${JSON.stringify(to)})`,
        }
      }

      // Resolve user:<id> against the staff roster. Reject reassigns to a
      // nonexistent user — otherwise the conversation would be stuck with no
      // human owner and no agent (since wake-handler skips non-agent assignees).
      let assignee: string
      if (parsed.kind === 'user') {
        const staff = await listStaff(ctx.organizationId)
        const hit =
          staff.find((s) => s.userId === parsed.id) ??
          staff.find((s) => s.displayName?.toLowerCase() === parsed.id.toLowerCase())
        if (!hit) {
          const roster =
            staff.length === 0
              ? '(no staff on this organization)'
              : staff.map((s) => `  user:${s.userId} — ${s.displayName ?? '(unnamed)'}`).join('\n')
          return {
            ok: false,
            error: `unknown staff: ${parsed.id}. Valid staff:\n${roster}\nUse a userId or displayName from \`vobase team list\`.`,
          }
        }
        assignee = `user:${hit.userId}`
      } else if (parsed.kind === 'agent') {
        assignee = `agent:${parsed.id}`
      } else {
        assignee = 'unassigned'
      }

      const conv = await reassignConversation(ctx.conversationId, assignee, `agent:${ctx.agentId}`, flags.reason)
      return {
        ok: true,
        content: `Reassigned conversation ${conv.id} → ${conv.assignee}${flags.reason ? ` (reason: ${flags.reason})` : ''}`,
      }
    },
  },
  {
    name: 'conv ask-staff',
    description:
      'Post an internal note mentioning one or more staff to ask a question. Their reply fires a supervisor wake so you can resume with the answer.',
    usage: 'vobase conv ask-staff --mention=<userId>[,<userId>...] --body="..."',

    async execute(argv, ctx) {
      const flags = parseFlags(argv)
      const mentionRaw = flags.mention
      const body = flags.body
      if (!mentionRaw) return { ok: false, error: 'missing required flag --mention' }
      if (!body) return { ok: false, error: 'missing required flag --body' }

      const rawTokens = mentionRaw
        .split(',')
        .map((x) => x.trim())
        .filter((x) => x.length > 0)
      if (rawTokens.length === 0) {
        return { ok: false, error: '--mention must list at least one staff userId or displayName' }
      }

      // Resolve each raw token to an actual staff userId. Accept: `user:<id>`,
      // a bare userId, or a displayName (case-insensitive). Bogus mentions
      // silently skip in the fan-out (mention-notify.ts) — fail here instead.
      const staff = await listStaff(ctx.organizationId)
      const byUserId = new Map(staff.map((s) => [s.userId, s]))
      const byName = new Map(
        staff
          .filter((s): s is typeof s & { displayName: string } => Boolean(s.displayName))
          .map((s) => [s.displayName.toLowerCase(), s]),
      )

      const resolvedMentions: string[] = []
      const resolvedNames: string[] = []
      const unresolved: string[] = []
      for (const token of rawTokens) {
        const bare = token.startsWith('user:') ? token.slice('user:'.length) : token
        const hit = byUserId.get(bare) ?? byName.get(bare.toLowerCase())
        if (hit) {
          // Mentions use the `staff:` prefix (see note-editor.tsx:89 +
          // team/service/mentions.ts). This is different from
          // conversations.assignee which uses `user:` — they're separate
          // concepts: assignee is ownership, mentions are notification targets.
          resolvedMentions.push(`staff:${hit.userId}`)
          resolvedNames.push(hit.displayName ?? hit.userId)
        } else unresolved.push(token)
      }

      if (unresolved.length > 0) {
        const roster =
          staff.length === 0
            ? '(no staff on this organization)'
            : staff.map((s) => `  user:${s.userId} — ${s.displayName ?? '(unnamed)'}`).join('\n')
        return {
          ok: false,
          error: `unknown staff: ${unresolved.join(', ')}. Valid staff:\n${roster}\nUse a userId or displayName from \`vobase team list\`.`,
        }
      }

      // Prepend @DisplayName tokens to the body so the rendered note shows
      // mentions inline — matches what the human composer serializes. Skip any
      // that the agent already wrote into the body so we don't double-tag.
      const missingTokens = resolvedNames
        .filter((name) => !new RegExp(`@${name.replace(/[.*+?^${}()|[\\]\\\\]/g, '\\\\$&')}\\b`, 'i').test(body))
        .map((name) => `@${name}`)
      const finalBody = missingTokens.length > 0 ? `${missingTokens.join(' ')} ${body}` : body

      const note = await addNote({
        conversationId: ctx.conversationId,
        organizationId: ctx.organizationId,
        author: { kind: 'agent', id: ctx.agentId },
        body: finalBody,
        mentions: resolvedMentions,
      })
      return {
        ok: true,
        content: `Posted internal note ${note.id} mentioning ${resolvedMentions.join(', ')}. Their reply will resume this conversation.`,
      }
    },
  },
]
