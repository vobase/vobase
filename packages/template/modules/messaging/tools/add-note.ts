/**
 * `add_note` — internal-note write to a conversation timeline. The note is
 * attributed to the agent via `ctx.agentId` and timestamped server-side.
 * Wired into both lanes:
 *   - Standalone (operator/heartbeat): leave breadcrumbs after triage, refund
 *     analysis, or a sweep.
 *   - Conversation (inbound/supervisor/approval-resumed): acknowledge a staff
 *     coaching note, summarise what was captured to MEMORY.md, or record a
 *     decision the agent made on the thread. Survives the coaching tool
 *     filter because it has no `audience: 'customer'` tag.
 *
 * **Mentions double as the "ask staff" affordance.** When `mentions` is
 * non-empty, each token is resolved against the staff roster (userId first,
 * then displayName lowercased), turned into `staff:<userId>` notification
 * targets, and prepended to the body as `@DisplayName` so the rendered note
 * shows the mention inline. The post-commit fan-out in `service/notes.ts`
 * then enqueues one supervisor wake per mentioned staff — when staff replies,
 * the agent wakes back up with `supervisorKind: 'ask_staff_answer'` and
 * customer-facing tools stay available.
 *
 * Ping-pong is gated in `messaging/service/notes.ts` — agent-authored notes
 * never trigger supervisor fan-out for the AUTHORING agent, so this tool
 * cannot recursively wake the caller.
 */

import { list as listStaff } from '@modules/team/service/staff'
import { type Static, Type } from '@sinclair/typebox'
import { defineAgentTool } from '@vobase/core'

import { addNote } from '../service/notes'

export const AddNoteInputSchema = Type.Object({
  conversationId: Type.Optional(
    Type.String({
      minLength: 1,
      description:
        'Conversation id the note attaches to. Optional — defaults to the current wake conversation. Required only on standalone-lane wakes (heartbeat / operator-thread) where you need to leave a breadcrumb on a different conversation.',
    }),
  ),
  body: Type.String({ minLength: 1, maxLength: 4000 }),
  mentions: Type.Optional(
    Type.Array(Type.String({ minLength: 1, maxLength: 64 }), {
      maxItems: 16,
      description:
        'Staff to notify — userIds or displayNames (resolved against `vobase team list`). Their reply fires a supervisor wake so you can resume with the answer. Omit for plain breadcrumbs.',
    }),
  ),
})

export type AddNoteToolInput = Static<typeof AddNoteInputSchema>

export const addNoteTool = defineAgentTool({
  name: 'add_note',
  description:
    'Append an internal note to a conversation timeline. Author is the agent. Pass `mentions` (userIds or displayNames) to ask staff a question — staff reply fires a supervisor wake.',
  schema: AddNoteInputSchema,
  errorCode: 'NOTES_ERROR',
  lane: 'both',
  prompt:
    "Two uses: (1) leave breadcrumbs on the timeline after triage / refund analysis / a heartbeat sweep — visible to staff, not to the customer; (2) ask staff a question by passing `mentions` — staff reply fires a supervisor wake and customer-facing tools stay available so you can relay the answer. Omit `conversationId` on conversation-lane wakes — it defaults to the current wake's conversation. Pass it explicitly only on standalone-lane wakes (heartbeat / operator-thread) when noting on a different conversation. For (2), do NOT invent userIds — run `vobase team list` first.",
  async run(args, ctx) {
    const tokens = args.mentions ?? []
    const resolvedMentions: string[] = []
    let finalBody = args.body

    if (tokens.length > 0) {
      // Resolve `user:<id>` / bare userId / displayName against the staff roster.
      // Bogus tokens silently skip in the fan-out (mention-notify.ts) — fail here
      // so the agent gets a deterministic error instead of a no-op note.
      const staff = await listStaff(ctx.organizationId)
      const byUserId = new Map(staff.map((s) => [s.userId, s]))
      const byName = new Map(
        staff
          .filter((s): s is typeof s & { displayName: string } => Boolean(s.displayName))
          .map((s) => [s.displayName.toLowerCase(), s]),
      )

      const resolvedNames: string[] = []
      const unresolved: string[] = []
      const seen = new Set<string>()
      for (const token of tokens) {
        const trimmed = token.trim()
        if (trimmed.length === 0) continue
        const bare = trimmed.startsWith('user:') ? trimmed.slice('user:'.length) : trimmed
        const hit = byUserId.get(bare) ?? byName.get(bare.toLowerCase())
        if (!hit) {
          unresolved.push(trimmed)
          continue
        }
        if (seen.has(hit.userId)) continue
        seen.add(hit.userId)
        // Mentions use the `staff:` prefix (see note-editor.tsx + team/service/mentions.ts).
        // Different from conversations.assignee which uses `user:` — assignee
        // is ownership, mentions are notification targets.
        resolvedMentions.push(`staff:${hit.userId}`)
        resolvedNames.push(hit.displayName ?? hit.userId)
      }

      if (unresolved.length > 0) {
        const roster =
          staff.length === 0
            ? '(no staff on this organization)'
            : staff.map((s) => `  user:${s.userId} — ${s.displayName ?? '(unnamed)'}`).join('\n')
        throw new Error(
          `unknown staff: ${unresolved.join(', ')}. Valid staff:\n${roster}\nUse a userId or displayName from \`vobase team list\`.`,
        )
      }

      // Prepend @DisplayName tokens to the body so the rendered note shows
      // mentions inline — matches what the human composer serializes. Skip any
      // already typed by the agent so we don't double-tag.
      const missingTokens = resolvedNames
        .filter((name) => !new RegExp(`@${name.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}\\b`, 'i').test(args.body))
        .map((name) => `@${name}`)
      finalBody = missingTokens.length > 0 ? `${missingTokens.join(' ')} ${args.body}` : args.body
    }

    const conversationId = args.conversationId ?? ctx.conversationId
    if (!conversationId) {
      throw new Error('add_note: no conversationId — pass one in args or call from a wake bound to a conversation.')
    }
    const row = await addNote({
      organizationId: ctx.organizationId,
      conversationId,
      author: { kind: 'agent', id: ctx.agentId },
      body: finalBody,
      mentions: resolvedMentions,
    })
    return { noteId: row.id, mentions: resolvedMentions }
  },
})
