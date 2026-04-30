/**
 * Agent-facing surfaces for the agents module.
 *
 * Listeners and materializers are per-wake factories — they close over wake-time
 * state (`fs`, `tracker`, `agentDefinition`, `contactId`) that the collector
 * cannot know at boot. Wake handler composes them alongside the static bundle.
 *
 * Materializers render `/agents/<id>/AGENTS.md` (generated from the agent
 * definition + registered commands via core's `generateAgentsMd()`) and
 * `/agents/<id>/MEMORY.md` (the agent's working-memory blob, falls back to
 * the empty-memory stub).
 *
 * `agentsAgentsMdContributors` owns the AGENTS.md slice describing agent-self
 * primitives — the agent's MEMORY.md write pattern, the skills/ folder, and
 * the /tmp/ scratch zone. Other modules contribute their own slices via the
 * same `agentsMd` slot on `AgentContributions`. Tool definitions live in
 * each owning module (messaging/contacts/schedules), not here.
 */

import type { IndexContributor, RoHintFn } from '@vobase/core'
import { defineIndexContributor, generateAgentsMd } from '@vobase/core'

import type { WakeMaterializerFactory } from '~/wake/context'
import { getCliRegistry } from './service/cli-registry'

/**
 * Helpdesk-flavoured AGENTS.md preamble. Replaces core's generic
 * DEFAULT_HEADER via `generateAgentsMd({ headerOverride })`. Each owning
 * module contributes its own scope-specific section via `agentsMd`.
 */
export const HELPDESK_AGENTS_MD_HEADER = `You operate inside a virtual workspace. Read files with \`cat\`, \`grep\`, \`head\`, \`tail\`; navigate with \`ls\`, \`find\`, \`tree\`. The workspace is read-by-default; specific zones below are writable and persist across wakes (your own \`MEMORY.md\`, the contact's \`MEMORY.md\`, the contact's drive folder, \`/tmp/\`). Customer-visible actions go through tool calls — derived files like \`messages.md\` and \`profile.md\` are rebuilt from DB state and cannot be \`echo >\`-edited. The sections below describe each scope and the right mutation path for it.`

const EMPTY_MEMORY_MD = '---\n---\n\n# Memory\n\n_empty_\n'

const AGENTS_MD_FILE = 'AGENTS.md'

/**
 * AGENTS.md RO-error hint for `/agents/<id>/AGENTS.md` itself. The
 * surrounding modules contribute hints for their own derived files; the wake
 * builder chains every module's contribution.
 */
export const agentsRoHints: RoHintFn[] = [
  (path) => {
    if (path.endsWith('/AGENTS.md')) {
      return `bash: ${path}: Read-only filesystem.\n  AGENTS.md is auto-generated from the agent definition, registered tools, and CLI reference. Edit the Instructions section in the Agents config page (or update the \`instructions\` column directly) to change agent behavior; do not write to this file.`
    }
    return null
  },
]

export const agentsAgentsMdContributors: readonly IndexContributor[] = [
  defineIndexContributor({
    file: AGENTS_MD_FILE,
    priority: 20,
    name: 'agents.self-state',
    render: () =>
      [
        '## Self-state',
        '',
        '- `/agents/<id>/AGENTS.md` — this file (frozen, regenerated each wake).',
        '- `/agents/<id>/MEMORY.md` — your working memory. Direct-writable like any markdown file (`cat`, `echo >>`, `sed`, heredocs). Persists across wakes automatically.',
        '- `/agents/<id>/skills/*.md` — how-to playbooks (read-only). Add new skills via the learning-flow observer, not direct writes.',
        '- `/tmp/` — scratch space (writable; cleared between wakes). Use for intermediate files, tool pipelines, debugging output.',
        '',
        '**Update your own memory:** `echo "- new lesson" >> /agents/<your-id>/MEMORY.md`, or `cat >> /agents/<your-id>/MEMORY.md <<EOF\\n\\n## $(date +%Y-%m-%d)\\n- <lesson>\\nEOF` for a dated section.',
      ].join('\n'),
  }),
]

/**
 * Agents materializer factory — produces `/agents/<id>/AGENTS.md` (composed
 * from the agent's instructions + every module's AGENTS.md slice + the lane-
 * filtered tool catalogue) and `/agents/<id>/MEMORY.md` (the agent's working
 * memory).
 */
export const agentsMaterializerFactory: WakeMaterializerFactory = (ctx) => {
  const { agentId, agentDefinition, tools, agentsMdContributors } = ctx
  // Render the same `## Commands` block the bash dispatcher exposes. Verbs
  // come from the unified `CliVerbRegistry`; staff-only verbs (audience
  // 'staff') aren't reachable inside a wake, so skip them in the prompt.
  const verbs = getCliRegistry()
    .list()
    .filter((v) => (v.audience ?? 'all') !== 'staff')
  const agentsMdSource = generateAgentsMd({
    agentName: agentDefinition.name,
    agentId,
    commands: verbs,
    tools,
    instructions: agentDefinition.instructions ?? '',
    headerOverride: HELPDESK_AGENTS_MD_HEADER,
    extraContributors: agentsMdContributors,
  })
  return [
    {
      path: `/agents/${agentId}/AGENTS.md`,
      phase: 'frozen',
      materialize: () => agentsMdSource,
    },
    {
      path: `/agents/${agentId}/MEMORY.md`,
      phase: 'frozen',
      materialize: () => agentDefinition.workingMemory || EMPTY_MEMORY_MD,
    },
  ]
}

export const agentsAgent = {
  agentsMd: [...agentsAgentsMdContributors],
  materializers: [agentsMaterializerFactory],
  roHints: [...agentsRoHints],
}
