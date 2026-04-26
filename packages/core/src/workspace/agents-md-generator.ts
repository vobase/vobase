/**
 * Generate an agent's `AGENTS.md` composite from the registered `vobase` CLI
 * verbs + the agent-authored `instructions` body + a short layout reference.
 *
 * This runs ONCE at `agent_start`; the rendered string lands in the frozen
 * system prompt. Never re-read mid-wake.
 *
 * Internally, the function builds an `IndexFileBuilder`, registers the four
 * canonical contributors (title, header, commands, instructions), and asks
 * the builder for the final document. Tenant projects that want to splice in
 * additional sections (e.g. an org-specific policy block) can use the builder
 * directly via `defineIndexContributor` — `generateAgentsMd` stays as the
 * happy-path one-liner.
 */
import type { CommandDef } from '../harness/types'
import { defineIndexContributor, IndexFileBuilder } from './index-file-builder'

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
  /** Extra contributors to splice in (e.g. policy block). Applied after the four built-ins. */
  extraContributors?: readonly Parameters<typeof defineIndexContributor>[0][]
}

/**
 * Minimal generic header used when the platform doesn't supply one. Real apps
 * are expected to pass a domain-specific header via `headerOverride`. The text
 * here only states the agent's basic posture so a stub deployment doesn't
 * render an empty section.
 */
const DEFAULT_HEADER = `You operate inside a virtual workspace. Read files with \`cat\`, \`grep\`, \`head\`, \`tail\`; navigate with \`ls\`, \`find\`, \`tree\`. Take side-effecting actions through the \`vobase\` CLI (listed below). Direct writes are blocked outside the writable zones declared by your project's read-only config.`

const FILE = 'AGENTS.md'

function renderCommandsSection(commands: readonly CommandDef[]): string {
  const sorted = [...commands].sort((a, b) => a.name.localeCompare(b.name))
  const lines = ['## Commands', '']
  if (sorted.length === 0) {
    lines.push('_No commands registered._')
    return lines.join('\n')
  }
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
  return lines.join('\n')
}

export function generateAgentsMd(opts: GenerateAgentsMdOpts): string {
  const builder = new IndexFileBuilder()
    .register(
      defineIndexContributor({
        file: FILE,
        priority: 0,
        name: 'title',
        render: () => `# ${opts.agentName} (${opts.agentId})`,
      }),
    )
    .register(
      defineIndexContributor({
        file: FILE,
        priority: 10,
        name: 'header',
        render: () => opts.headerOverride ?? DEFAULT_HEADER,
      }),
    )
    .register(
      defineIndexContributor({
        file: FILE,
        priority: 100,
        name: 'commands',
        render: () => renderCommandsSection(opts.commands),
      }),
    )
    .register(
      defineIndexContributor({
        file: FILE,
        priority: 200,
        name: 'instructions',
        render: () => {
          const body = opts.instructions.trim() || '_No instructions authored yet._'
          return `## Instructions\n\n${body}`
        },
      }),
    )
  if (opts.extraContributors) builder.registerAll(opts.extraContributors)
  return builder.build({ file: FILE })
}
