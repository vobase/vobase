/**
 * Helpdesk-flavoured AGENTS.md header + RO-error hints.
 *
 * Core stays platform-agnostic (`@vobase/core` ships only a generic preamble
 * and a `roMessageOverride` hook). The template owns the rich layout text and
 * scope-specific recovery hints because they reference the helpdesk-shaped
 * scope model: `/contacts/<id>/`, `/staff/<id>/`, `/drive/`, the `reply` tool,
 * the `vobase memory` CLI verb set, etc.
 */

export const HELPDESK_AGENTS_MD_HEADER = `You operate inside a virtual workspace. Read files with \`cat\`, \`grep\`, \`head\`, \`tail\`; navigate with \`ls\`, \`find\`, \`tree\`. Take side-effecting actions through the \`vobase\` CLI (listed below). Writes are blocked outside \`/contacts/<id>/drive/\` and \`/tmp/\`.

## Layout

- \`/agents/<id>/AGENTS.md\` — this file (frozen)
- \`/agents/<id>/MEMORY.md\` — your working memory (written via \`vobase memory …\`)
- \`/agents/<id>/skills/*.md\` — how-to playbooks (read-only)
- \`/drive/*\` — organization knowledge base (read-only; propose additions via CLI)
- \`/drive/BUSINESS.md\` — organization brand + policies (frozen)
- \`/contacts/<id>/profile.md\` — contact identity (read-only; first line carries the identity)
- \`/contacts/<id>/MEMORY.md\` — per-contact working memory (written via \`vobase memory … --scope=contact\`)
- \`/contacts/<id>/<channelInstanceId>/messages.md\` — customer-visible timeline (read-only)
- \`/contacts/<id>/<channelInstanceId>/internal-notes.md\` — staff ↔ agent notes (read-only)
- \`/contacts/<id>/drive/\` — per-contact upload space (writable)
- \`/staff/<id>/profile.md\` — staff identity (read-only; first line carries the identity)
- \`/staff/<id>/MEMORY.md\` — per-(agent, staff) memory (written via \`vobase memory …\`)
- \`/tmp/\` — scratch space (writable; cleared between wakes)

## Write patterns

Most of the workspace is read-only; derived files (AGENTS.md, profile.md, messages.md, internal-notes.md) are rebuilt from DB state and cannot be edited with \`echo >\`. Use the right mutation path for each scope:

- **Update your own memory** (\`/agents/<id>/MEMORY.md\`): \`vobase memory set <heading> "<body>"\` (default scope is \`agent\`), or \`vobase memory append "<line>"\`, \`vobase memory remove <heading>\`.
- **Update contact memory** (\`/contacts/<id>/MEMORY.md\`): \`vobase memory set <heading> "<body>" --scope=contact\`.
- **Update staff-facing memory** (\`/staff/<id>/MEMORY.md\`): \`vobase memory set <heading> "<body>" --scope=staff --staff=<staffId>\`.
- **Propose an organization drive change** (\`/drive/**\`): \`vobase drive propose --path=/<path> --body="..."\` — staff reviews and accepts or rejects; do not write to \`/drive/\` directly.
- **Scratch work**: \`/tmp/<anything>\` is writable and wiped between wakes — use it for intermediate files, tool pipelines, debugging output.
- **Reply to the customer**: call the \`reply\` tool (or \`send_card\`, \`send_file\` for structured messages); \`/contacts/<id>/<channelId>/messages.md\` is derived and cannot be appended to.`

/**
 * Helpdesk-shape RO-error hints. Returns the recovery message for known
 * derived/RO paths or `null` for unknown paths so the core enforcer falls
 * back to its generic message.
 */
export function helpdeskRoMessage(path: string): string | null {
  if (path.startsWith('/drive/')) {
    const rel = path.slice('/drive'.length)
    return `bash: ${path}: Read-only filesystem.\n  This path is organization-scope (read-only to agents). Use \`vobase drive propose --scope=organization --path=${rel} --body=...\` to suggest a change for staff review.`
  }
  if (path.endsWith('/AGENTS.md')) {
    return `bash: ${path}: Read-only filesystem.\n  AGENTS.md is auto-generated from the agent definition, registered tools, and CLI reference. Edit the Instructions section in the Agents config page (or update the \`instructions\` column directly) to change agent behavior; do not write to this file.`
  }
  if (path.startsWith('/staff/') && path.endsWith('/profile.md')) {
    return `bash: ${path}: Read-only filesystem.\n  Staff profile is derived from the staff record (display name, role, expertise, timezone). Edit fields in the Team UI; do not write to this file.`
  }
  if (path.startsWith('/contacts/') && path.endsWith('/profile.md')) {
    return `bash: ${path}: Read-only filesystem.\n  Contact profile is derived from the contact record. Edit fields in the Contacts UI or via the contacts service; do not write to this file.`
  }
  if (path.endsWith('/messages.md')) {
    return `bash: ${path}: Read-only filesystem.\n  The conversation timeline is derived from channel events. Use the \`reply\` tool (or \`send_card\`, \`send_file\`) to send a customer-visible message; do not append to this file.`
  }
  if (path.endsWith('/internal-notes.md')) {
    return `bash: ${path}: Read-only filesystem.\n  Internal notes are derived from staff-authored events in the messaging module. This file reflects, but does not accept, new notes.`
  }
  return null
}
