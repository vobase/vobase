/**
 * Generate `/workspace/AGENTS.md` content from the registered `vobase` CLI
 * verbs + a short workspace layout reference.
 *
 * This runs ONCE at `agent_start`; the rendered string lands in the frozen
 * system prompt. Never re-read mid-wake.
 */
import type { CommandDef } from '@server/contracts/plugin-context'

export interface GenerateAgentsMdOpts {
  /** Aggregated from every module's `init(ctx).registerCommand(...)`. */
  commands: readonly CommandDef[]
  /** If the platform wants to override the header (e.g. per-organization). */
  headerOverride?: string
}

const DEFAULT_HEADER = `# Vobase Workspace — Agent Manual

You operate inside a virtual workspace at \`/workspace/\`. Read files with
\`cat\`, \`grep\`, \`head\`, \`tail\`; navigate with \`ls\`, \`find\`, \`tree\`. Take
side-effecting actions through the \`vobase\` CLI (listed below). All non-vobase
writes are blocked outside \`/workspace/contact/drive/\` and \`/workspace/tmp/\`.

## Layout

- \`AGENTS.md\` — this file (frozen)
- \`SOUL.md\` — your role, scope, voice, tools (frozen, per-agent)
- \`MEMORY.md\` — your working memory (written via \`vobase memory …\`)
- \`skills/*.md\` — how-to playbooks (read-only)
- \`drive/*\` — organization knowledge base (read-only; propose additions via CLI)
- \`drive/BUSINESS.md\` — organization brand + policies (frozen)
- \`conversation/messages.md\` — customer-visible timeline
- \`conversation/internal-notes.md\` — staff ↔ agent notes
- \`contact/profile.md\` — contact identity (read-only)
- \`contact/MEMORY.md\` — per-contact working memory (written via \`vobase memory … --scope=contact\`)
- \`contact/bookings.md\` — appointments summary
- \`contact/drive/\` — per-contact upload space (writable)
- \`tmp/\` — scratch space (writable; cleared between wakes)

## Commands
`

export function generateAgentsMd(opts: GenerateAgentsMdOpts): string {
  const header = opts.headerOverride ?? DEFAULT_HEADER
  const sorted = [...opts.commands].sort((a, b) => a.name.localeCompare(b.name))
  if (sorted.length === 0) {
    return `${header}\n_No commands registered._\n`
  }
  const lines: string[] = []
  for (const cmd of sorted) {
    lines.push(`### \`vobase ${cmd.name}\``)
    if (cmd.description) lines.push(cmd.description)
    if (cmd.usage) {
      lines.push('')
      lines.push('```')
      lines.push(cmd.usage)
      lines.push('```')
    }
    lines.push('')
  }
  return `${header}\n${lines.join('\n')}`
}
