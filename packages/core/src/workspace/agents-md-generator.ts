/**
 * Generate an agent's `AGENTS.md` composite from the registered `vobase` CLI
 * verbs + the agent-authored `instructions` body + a short layout reference.
 *
 * This runs ONCE at `agent_start`; the rendered string lands in the frozen
 * system prompt. Never re-read mid-wake.
 */
import type { CommandDef } from '../harness/types'

export interface GenerateAgentsMdOpts {
  /** Agent display name; rendered in the title line. */
  agentName: string
  /** Agent nanoid; rendered in the title line and resolved folder identity. */
  agentId: string
  /** Aggregated from every module's `init(ctx).registerCommand(...)`. */
  commands: readonly CommandDef[]
  /** Agent-authored operating manual (formerly `soul_md`). Rendered verbatim under `## Instructions`. */
  instructions: string
  /** If the platform wants to override the framework preamble (e.g. per-organization). */
  headerOverride?: string
}

const DEFAULT_HEADER = `You operate inside a virtual workspace. Read files with \`cat\`,
\`grep\`, \`head\`, \`tail\`; navigate with \`ls\`, \`find\`, \`tree\`. Take
side-effecting actions through the \`vobase\` CLI (listed below). Writes are
blocked outside \`/contacts/<id>/drive/\` and \`/tmp/\`.

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
`

export function generateAgentsMd(opts: GenerateAgentsMdOpts): string {
  const header = opts.headerOverride ?? DEFAULT_HEADER
  const titleLine = `# ${opts.agentName} (${opts.agentId})`
  const sorted = [...opts.commands].sort((a, b) => a.name.localeCompare(b.name))

  const commandLines: string[] = ['## Commands', '']
  if (sorted.length === 0) {
    commandLines.push('_No commands registered._', '')
  } else {
    for (const cmd of sorted) {
      commandLines.push(`### \`vobase ${cmd.name}\``)
      if (cmd.description) commandLines.push(cmd.description)
      if (cmd.usage) {
        commandLines.push('')
        commandLines.push('```')
        commandLines.push(cmd.usage)
        commandLines.push('```')
      }
      commandLines.push('')
    }
  }

  const instructionsSection = ['## Instructions', '', opts.instructions.trim() || '_No instructions authored yet._', '']

  return [titleLine, '', header, commandLines.join('\n'), instructionsSection.join('\n')].join('\n')
}
