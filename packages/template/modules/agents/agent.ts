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

import type { AgentTool, IndexContributor, RoHintFn, SideLoadContributor } from '@vobase/core'
import { defineIndexContributor, generateAgentsMd, isVerbVisible } from '@vobase/core'

import { buildWakeAgentsMdScratch } from '~/wake/agents-md-scratch'
import type { WakeMaterializerFactory } from '~/wake/context'
import { DEFAULT_MEMORY_SOFT_CAP_CHARS, renderMemoryWithBudget, stripBudgetHeader } from '~/wake/memory-budget'
import { listSkillsForAgent } from './service/changes'
import { getCliRegistry } from './service/cli-registry'
import { learningCandidatesSideLoadContributor } from './service/learning-candidates-sideload'
import { dismissCandidateTool } from './tools/dismiss-candidate'
import { rememberTool } from './tools/remember'

/**
 * Helpdesk-flavoured AGENTS.md preamble. Replaces core's generic
 * DEFAULT_HEADER via `generateAgentsMd({ headerOverride })`. Each owning
 * module contributes its own scope-specific section via `agentsMd`.
 */
export const HELPDESK_AGENTS_MD_HEADER = `You are operating in a project at \`/\`. \`cat\`, \`grep\`, \`ls\`, \`find\`, \`head\`, \`tail\` work normally; \`/tmp/\` is writable scratch.

**Look around before responding.** When a message names a file, person, skill, or topic, \`cat\` the relevant path first — don't reason from memory alone.

Three ways to make changes: **file writes** (\`echo >>\`, heredoc, \`sed\`) for prose memory; **CLI verbs** (\`vobase contacts propose-change\`, \`vobase drive propose\`, …) for structured fields and doc edits — check the returned \`status\` (\`auto_applied\` / \`pending\`); **tool calls** (\`reply\`, \`add_note\`, …) for customer-visible actions.`

const EMPTY_MEMORY_MD = '---\n---\n\n# Memory\n\n_empty_\n'

const AGENTS_MD_FILE = 'AGENTS.md'

/**
 * Capture-trigger keyword list — phrases the agent should treat as durable
 * mid-wake self-lessons worth echoing into `/agents/<your-id>/MEMORY.md`.
 * Exported so structural tests can assert each keyword reaches the rendered
 * `agents.memory-capture-triggers` contributor body word-bounded.
 *
 * Three-scope memory model: this list governs the AGENT scope only. Contact
 * facts and per-`(agent, staff)` preferences route to their own scopes — see
 * the `agents.memory-conventions` contributor for the full table.
 */
export const MEMORY_CAPTURE_TRIGGERS = ['always', 'never', 'from now on', 'remember that', 'next time'] as const

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
    render: () => {
      return [
        '## Self-state',
        '',
        '- `/agents/<id>/MEMORY.md` — your working memory (inlined above as `## Active lessons`).',
        '- `/agents/<id>/skills/<name>/SKILL.md` — how-to playbooks. `ls /agents/<id>/skills/` to discover; `cat` the file for the full body.',
        '- `/tmp/` — writable scratch (cleared between wakes).',
      ].join('\n')
    },
  }),
  defineIndexContributor({
    file: AGENTS_MD_FILE,
    priority: 25,
    name: 'agents.memory-capture-triggers',
    render: () => {
      return [
        '## When to capture',
        '',
        "Staff coaching is captured automatically by the self-learn loop — it appears in your MEMORY.md as `## Staff signal —` sections. Don't `echo >>` it again.",
        '',
        'Capture proactively when: a customer volunteers a fact (company, role, deadline) — write to `/contacts/<id>/MEMORY.md` **before** replying; you derive a durable self-rule — trigger phrases ' +
          MEMORY_CAPTURE_TRIGGERS.map((kw) => `\`${kw}\``).join(', ') +
          ' — append to `/agents/<id>/MEMORY.md`; you note a per-staff preference — write to `/staff/<staffId>/MEMORY.md`.',
      ].join('\n')
    },
  }),
  defineIndexContributor({
    file: AGENTS_MD_FILE,
    priority: 26,
    name: 'agents.memory-conventions',
    render: () => {
      return [
        '## Memory scopes',
        '',
        '| Scope | Path | Write with |',
        '| --- | --- | --- |',
        '| agent | `/agents/<id>/MEMORY.md` | `echo "- fact" >>`, dated `## YYYY-MM-DD` section |',
        '| contact | `/contacts/<id>/MEMORY.md` (prose) or `vobase contacts propose-change` (fields) | direct write / CLI verb |',
        '| staff | `/staff/<staffId>/MEMORY.md` | `echo "- fact" >>` under `## About <name>` |',
      ].join('\n')
    },
  }),
]

/**
 * Agents materializer factory — produces `/agents/<id>/AGENTS.md` (composed
 * from the agent's instructions + every module's AGENTS.md slice + the lane-
 * filtered tool catalogue) and `/agents/<id>/MEMORY.md` (the agent's working
 * memory).
 */
export const agentsMaterializerFactory: WakeMaterializerFactory = (ctx) => {
  const { agentId, agentDefinition, tools, agentsMdContributors, lane, triggerKind, audienceTier } = ctx
  // Render the same `## Commands` block the bash dispatcher exposes. Verbs
  // come from the unified `CliVerbRegistry`; tier filter mirrors the in-bash
  // `--help` filter so AGENTS.md and `vobase --help` agree per wake.
  const verbs = getCliRegistry()
    .list()
    .filter((v) => isVerbVisible(v.audience, audienceTier))
  const agentsMdSource = generateAgentsMd({
    agentName: agentDefinition.name,
    agentId,
    commands: verbs,
    tools,
    instructions: agentDefinition.instructions ?? '',
    headerOverride: HELPDESK_AGENTS_MD_HEADER,
    extraContributors: agentsMdContributors,
    // Wake-time facts forwarded to module-side AGENTS.md contributors so
    // they can emit lane-aware prose (e.g. messaging's staff-note
    // block) without coupling those modules to the wake harness. Readers go
    // through `getWakeAgentsMdScratch` from `~/wake/agents-md-scratch`.
    scratch: buildWakeAgentsMdScratch({ lane, triggerKind }),
  })
  return [
    {
      path: `/agents/${agentId}/AGENTS.md`,
      phase: 'frozen',
      materialize: async () => {
        const learned = await listSkillsForAgent({
          organizationId: agentDefinition.organizationId,
          agentId,
        })
        if (learned.length === 0) return agentsMdSource
        const lines: string[] = [
          '',
          '## Skills',
          '',
          "These skills provide specialized instructions for specific tasks. When a task matches a skill's description, `cat` the listed `SKILL.md` to load its full body before proceeding. Bundled resources (relative paths inside the skill body) resolve against the skill's folder.",
          '',
        ]
        for (const s of learned) {
          const desc = (s.description ?? '').slice(0, 200) || '(no description)'
          lines.push(`- \`${s.name}\` — ${desc}`)
          lines.push(`  Location: \`/agents/${agentId}/skills/${s.name}/SKILL.md\``)
        }
        return `${agentsMdSource}\n${lines.join('\n')}\n`
      },
    },
    {
      path: `/agents/${agentId}/MEMORY.md`,
      phase: 'frozen',
      materialize: () => {
        const stored = stripBudgetHeader(agentDefinition.workingMemory ?? '')
        const body = stored.length > 0 ? stored : EMPTY_MEMORY_MD
        const header = renderMemoryWithBudget({
          scope: 'agent',
          id: agentId,
          body,
          softCapChars: DEFAULT_MEMORY_SOFT_CAP_CHARS,
        })
        return `${header}${body}`
      },
    },
  ]
}

export const agentsTools: readonly AgentTool[] = [rememberTool, dismissCandidateTool]

export const agentsSideLoad: readonly SideLoadContributor[] = [learningCandidatesSideLoadContributor]

export const agentsAgent = {
  agentsMd: [...agentsAgentsMdContributors],
  materializers: [agentsMaterializerFactory],
  roHints: [...agentsRoHints],
  tools: [...agentsTools],
  sideLoad: [...agentsSideLoad],
}
