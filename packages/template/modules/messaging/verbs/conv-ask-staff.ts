/**
 * `vobase conv ask-staff` — post an internal note mentioning one or more
 * staff so they answer a question. Staff's reply fires a `supervisor` wake
 * with `supervisorKind: 'ask_staff_answer'` so the agent can resume.
 *
 * Agent-only (`audience: 'agent'`): the verb body relies on
 * `ctx.principal.kind === 'agent'` to author the note, and the wake context
 * supplies the conversationId. HTTP-RPC has no business posting agent-
 * authored notes.
 */

import { list as listStaff } from '@modules/team/service/staff'
import { defineCliVerb } from '@vobase/core'
import { z } from 'zod'

import { addNote } from '../service/notes'

export const convAskStaffVerb = defineCliVerb({
  name: 'conv ask-staff',
  description:
    'Post an internal note mentioning one or more staff to ask a question. Their reply fires a supervisor wake so you can resume with the answer.',
  usage: 'vobase conv ask-staff --mention=<userId>[,<userId>...] --body="..."',
  audience: 'agent',
  prompt:
    "Use when you need staff input before continuing — clarification, policy decisions, anything you can't answer from MEMORY.md or `/drive/`. Staff's reply fires a `supervisor` wake with `supervisorKind: ask_staff_answer` and customer-facing tools stay available so you can relay the answer. Do NOT invent userIds — run `vobase team list` first.",
  input: z.object({
    mention: z.string().min(1, 'mention must list at least one staff userId or displayName'),
    body: z.string().min(1, 'body is required'),
  }),
  body: async ({ input, ctx }) => {
    if (ctx.principal.kind !== 'agent') {
      return { ok: false as const, error: 'conv ask-staff is agent-authored only', errorCode: 'forbidden' }
    }
    const conversationId = ctx.wake?.conversationId
    if (!conversationId) {
      return { ok: false as const, error: 'no wake conversation in context', errorCode: 'invalid_input' }
    }

    const rawTokens = input.mention
      .split(',')
      .map((x) => x.trim())
      .filter((x) => x.length > 0)
    if (rawTokens.length === 0) {
      return {
        ok: false as const,
        error: '--mention must list at least one staff userId or displayName',
        errorCode: 'invalid_input',
      }
    }

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

    const resolvedMentions: string[] = []
    const resolvedNames: string[] = []
    const unresolved: string[] = []
    for (const token of rawTokens) {
      const bare = token.startsWith('user:') ? token.slice('user:'.length) : token
      const hit = byUserId.get(bare) ?? byName.get(bare.toLowerCase())
      if (hit) {
        // Mentions use the `staff:` prefix (see note-editor.tsx + team/service/mentions.ts).
        // Different from conversations.assignee which uses `user:` — assignee
        // is ownership, mentions are notification targets.
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
        ok: false as const,
        error: `unknown staff: ${unresolved.join(', ')}. Valid staff:\n${roster}\nUse a userId or displayName from \`vobase team list\`.`,
        errorCode: 'invalid_input',
      }
    }

    // Prepend @DisplayName tokens to the body so the rendered note shows
    // mentions inline — matches what the human composer serializes. Skip any
    // already typed by the agent so we don't double-tag.
    const missingTokens = resolvedNames
      .filter((name) => !new RegExp(`@${name.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}\\b`, 'i').test(input.body))
      .map((name) => `@${name}`)
    const finalBody = missingTokens.length > 0 ? `${missingTokens.join(' ')} ${input.body}` : input.body

    const note = await addNote({
      conversationId,
      organizationId: ctx.organizationId,
      author: { kind: 'agent', id: ctx.principal.id },
      body: finalBody,
      mentions: resolvedMentions,
    })
    return {
      ok: true as const,
      data: { noteId: note.id, mentions: resolvedMentions },
      summary: `Posted internal note ${note.id} mentioning ${resolvedMentions.join(', ')}. Their reply will resume this conversation.`,
    }
  },
  formatHint: 'json',
})
