/**
 * Sensitive-write warner — same-turn `bash` tool feedback when the agent
 * edits a gated frontmatter field on a profile.md.
 *
 * The workspace-sync observer fires at `agent_end`, which means a `field_set`
 * proposal is materialised AFTER the wake's last turn. By then the agent has
 * already replied to the customer — usually with a confident "done!" that
 * doesn't reflect the fact the change is still pending staff approval.
 *
 * This listener closes that loop in-band: after every `bash` tool call we
 * re-read each tracked profile.md, diff the frontmatter against a rolling
 * baseline, and append a stderr notice when the diff includes any gated
 * field. The notice arrives in the SAME tool result the model is about to
 * read, so the next assistant message can phrase the customer reply as
 * "I've requested an update, our team will confirm shortly" rather than
 * claiming the change is live.
 *
 * Lazy baseline: the first time we see a path we just record the current
 * content and emit nothing — otherwise the very first bash call after wake
 * start would always look "changed" relative to an empty baseline.
 */

import type { HarnessLogger, OnToolResultCtx, OnToolResultListener } from '@vobase/core'
import type { IFileSystem } from 'just-bash'

import { diffProfile, parseFrontmatter } from '../profile-frontmatter'
import { CONTACT_GATED_FIELDS, STAFF_GATED_FIELDS } from './gated-fields'

export interface SensitiveWriteWarnerOpts {
  fs: IFileSystem
  /** Conversation-lane wakes have one; standalone wakes pass null. */
  contactId?: string | null
  /** All staff ids materialised into this wake (`/staff/<id>/profile.md`). */
  staffIds: readonly string[]
  logger: HarnessLogger
}

interface BashContent {
  stdout: string
  stderr: string
  exitCode: number
}

interface BashResultShape {
  content?: BashContent
}

function isBashContent(value: unknown): value is BashContent {
  if (!value || typeof value !== 'object') return false
  const v = value as Record<string, unknown>
  return typeof v.stdout === 'string' && typeof v.stderr === 'string' && typeof v.exitCode === 'number'
}

function profilePathsFor(opts: SensitiveWriteWarnerOpts): {
  contact: string | null
  staff: readonly { id: string; path: string }[]
} {
  return {
    contact: opts.contactId ? `/contacts/${opts.contactId}/profile.md` : null,
    staff: opts.staffIds.map((id) => ({ id, path: `/staff/${id}/profile.md` })),
  }
}

function pickGatedFields(
  beforeBody: string,
  afterBody: string,
  gated: ReadonlySet<string>,
): { key: string; from: unknown; to: unknown }[] {
  const before = parseFrontmatter(beforeBody) ?? {}
  const after = parseFrontmatter(afterBody) ?? {}
  const diff = diffProfile(before, after)
  const out: { key: string; from: unknown; to: unknown }[] = []
  for (const [key, change] of Object.entries(diff.fields)) {
    // Only warn on TOP-LEVEL gated keys. Attribute-namespaced keys
    // (`attributes.*`) are never gated and shouldn't trigger a notice.
    if (!gated.has(key)) continue
    out.push({ key, from: change.from, to: change.to })
  }
  return out
}

/**
 * Render a gated value in the warning. Trim long strings so the notice stays
 * readable in the tool result without dumping a giant frontmatter blob.
 */
function fmtValue(v: unknown): string {
  if (v === null || v === undefined) return '(empty)'
  if (typeof v === 'string') {
    const trimmed = v.length > 80 ? `${v.slice(0, 77)}…` : v
    return `"${trimmed}"`
  }
  if (typeof v === 'number' || typeof v === 'boolean') return String(v)
  return JSON.stringify(v)
}

function buildWarning(
  scope: 'contact' | 'staff',
  resourceLabel: string,
  changes: { key: string; from: unknown; to: unknown }[],
): string {
  const lines: string[] = []
  lines.push(`vobase notice: gated field edit detected on ${resourceLabel}.`)
  for (const c of changes) {
    lines.push(`  - ${c.key}: ${fmtValue(c.from)} → ${fmtValue(c.to)}`)
  }
  lines.push('')
  if (scope === 'contact') {
    lines.push(
      'These keys (displayName, email) are gated for contact records: the workspace observer will queue a PENDING change-proposal at the end of this wake instead of writing to the database. The customer will NOT see the change until staff approves it from the inbox.',
    )
    lines.push('')
    lines.push(
      "Do NOT tell the customer the change is done. Phrase your reply as a request that has been logged for review (e.g. \"I've flagged this with our team to update on your account — we'll confirm once it's applied\"). If the customer pushes for an immediate change, ask them to send the request from a verified channel (corporate email / IT mailbox) so staff can fast-track approval.",
    )
  } else {
    lines.push(
      'Staff records always queue: the workspace observer will surface this edit as a PENDING proposal that staff must approve before the team directory reflects it.',
    )
  }
  return lines.join('\n')
}

/**
 * Cheap text match against the bash command. We only need to read profile.md
 * files when the command actually references one — `cat /messages.md`,
 * `ls /agents`, `echo` to MEMORY.md etc. should short-circuit and skip the
 * disk reads entirely. The check is intentionally permissive (substring, not
 * regex) so a missed match falls through to the full diff path; the goal is
 * "skip the obvious cases", not perfect precision.
 */
function bashMayTouchProfile(args: unknown): boolean {
  if (!args || typeof args !== 'object') return true
  const command = (args as { command?: unknown }).command
  if (typeof command !== 'string') return true
  return command.includes('profile.md') || command.includes('/contacts/') || command.includes('/staff/')
}

export function createSensitiveWriteWarner(opts: SensitiveWriteWarnerOpts): OnToolResultListener {
  const baseline = new Map<string, string>()
  const paths = profilePathsFor(opts)

  return async (ctx: OnToolResultCtx) => {
    if (ctx.toolName !== 'bash') return undefined
    if (!bashMayTouchProfile(ctx.args)) return undefined

    const targets: { kind: 'contact' | 'staff'; path: string; staffId?: string }[] = []
    if (paths.contact) targets.push({ kind: 'contact', path: paths.contact })
    for (const { id, path } of paths.staff) targets.push({ kind: 'staff', path, staffId: id })

    const reads = await Promise.all(
      targets.map(async (t) => {
        try {
          return { target: t, content: await opts.fs.readFile(t.path) }
        } catch (err) {
          opts.logger.warn({ err, path: t.path, staffId: t.staffId }, 'sensitive-write-warner: profile.md read failed')
          return null
        }
      }),
    )

    const warnings: string[] = []
    for (const read of reads) {
      if (!read) continue
      const { target, content } = read
      const before = baseline.get(target.path)
      baseline.set(target.path, content)
      if (before === undefined || before === content) continue
      const gateSet = target.kind === 'contact' ? CONTACT_GATED_FIELDS : STAFF_GATED_FIELDS
      const gated = pickGatedFields(before, content, gateSet)
      if (gated.length === 0) continue
      warnings.push(buildWarning(target.kind, target.path, gated))
    }

    if (warnings.length === 0) return undefined

    const candidate = (ctx.result as unknown as BashResultShape).content
    if (!isBashContent(candidate)) {
      // Tool result didn't have the bash shape — likely an early bash error
      // before the inner exec returned. Skip rather than risk corrupting an
      // unfamiliar payload.
      return undefined
    }

    const stderrJoined = warnings.join('\n\n')
    const newStderr = candidate.stderr ? `${candidate.stderr}\n\n${stderrJoined}` : stderrJoined
    return { content: { ...candidate, stderr: newStderr } }
  }
}
