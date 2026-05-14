/**
 * Shared staff-token resolution for messaging tools (`consult_staff`, and
 * historically `add_note`'s mentions). Resolves userIds / `user:<id>` /
 * display names against the org's staff roster into `staff:<userId>`
 * notification targets.
 */

import { list as listStaff } from '@modules/team/service/staff'

export interface ResolvedStaffMentions {
  /** `staff:<userId>` notification targets. */
  mentions: string[]
  /** Display names (or userId fallback), parallel to `mentions`. */
  names: string[]
}

/**
 * Resolve staff tokens into `staff:<userId>` notification targets. Throws a
 * deterministic error listing the roster when any token is unresolvable, so
 * the agent gets a fixable message instead of a silent no-op.
 *
 * `mentions` use the `staff:` prefix (see note-editor.tsx + team/service/mentions.ts).
 * Different from `conversations.assignee` which uses `user:` — assignee is
 * ownership, mentions are notification targets.
 */
export async function resolveStaffMentions(
  organizationId: string,
  tokens: readonly string[],
): Promise<ResolvedStaffMentions> {
  const staff = await listStaff(organizationId)
  const byUserId = new Map(staff.map((s) => [s.userId, s]))
  const byName = new Map(
    staff
      .filter((s): s is typeof s & { displayName: string } => Boolean(s.displayName))
      .map((s) => [s.displayName.toLowerCase(), s]),
  )

  const mentions: string[] = []
  const names: string[] = []
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
    mentions.push(`staff:${hit.userId}`)
    names.push(hit.displayName ?? hit.userId)
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

  return { mentions, names }
}

/**
 * Prepend `@DisplayName` tokens to `body` for any name not already tagged —
 * matches what the human note composer serializes so the rendered note shows
 * mentions inline.
 */
export function prependMentionTags(body: string, names: readonly string[]): string {
  const missing = names
    .filter((name) => !new RegExp(`@${name.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}\\b`, 'i').test(body))
    .map((name) => `@${name}`)
  return missing.length > 0 ? `${missing.join(' ')} ${body}` : body
}
