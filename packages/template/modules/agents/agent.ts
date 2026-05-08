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
export const HELPDESK_AGENTS_MD_HEADER = `You operate inside a virtual workspace. Read files with \`cat\`, \`grep\`, \`head\`, \`tail\`; navigate with \`ls\`, \`find\`, \`tree\`.

ALL-CAPS filenames are framework-managed (\`AGENTS.md\`, \`INDEX.md\`, \`MEMORY.md\`, \`PROFILE.md\`, \`MESSAGES.md\`, \`INTERNAL-NOTES.md\`, \`BUSINESS.md\`); lowercase paths are real files (drive uploads, \`/tmp/\` scratch).

There are three write paths and you must use them on purpose:

1. **Direct file writes** (\`echo\`, \`cat >>\`, heredocs, \`sed\`) for \`MEMORY.md\` only (prose narrative, three scopes). Edits are observed at \`agent_end\` and flush to a virtual column.

2. **CLI verbs** (\`vobase contacts propose-change\`, \`vobase drive propose\`, …) for structured edits to read-only resources. The owning row routes through the change-proposal pipeline — non-gated fields auto-apply, gated fields queue for staff review. Inspect the returned \`status\` to know what to tell the customer.

3. **Tool calls** for user-visible actions (\`reply\`, \`send_card\`, \`send_file\`, \`book_slot\`) and cross-cutting effects (\`add_note\`, \`vobase conv reassign\`).

Auto-rendered files (\`PROFILE.md\`, \`MESSAGES.md\`, \`INTERNAL-NOTES.md\`, \`AGENTS.md\`, \`INDEX.md\`, \`BUSINESS.md\`) are rebuilt from DB state every wake and cannot be \`echo >\`-edited — they reflect, but do not accept, writes. To mutate the underlying row, use the relevant CLI verb.

The sections below describe each scope and which path applies.`

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
    render: () =>
      [
        '## Self-state',
        '',
        '- `/agents/<id>/MEMORY.md` — your working memory. Latest contents are inlined in the `## Active lessons` section above; treat that as canonical for this wake.',
        '- `/agents/<id>/skills/<name>/SKILL.md` — how-to playbooks (per the [agentskills.io spec](https://agentskills.io/specification)). Catalog (name + description) is in the `## Skills` section; `cat` the file for the full body. Add new skills via the `remember` tool with `scope=agents.learned_skill`.',
        '- `/tmp/` — scratch space (writable; cleared between wakes). Use for intermediate files, tool pipelines, debugging output.',
        '',
        'See the `## When to capture` and `## Memory scopes` sections below for capture rules and the three-scope routing table.',
      ].join('\n'),
  }),
  defineIndexContributor({
    file: AGENTS_MD_FILE,
    priority: 25,
    name: 'agents.memory-capture-triggers',
    render: () =>
      [
        '## When to capture',
        '',
        'Staff signals (`internal_note_added`, supervisor coaching, etc.) are captured automatically by the self-learn loop — they appear in your MEMORY.md as `## Staff signal —` sections without you needing to do anything. Do NOT echo them with `echo >>`; you would just double-write the same coaching.',
        '',
        'Your capture job is for the cases the auto-loop does not cover:',
        '',
        `1. **Customer-volunteered facts** (company, role, deadline, use case) → \`/contacts/<id>/MEMORY.md\` BEFORE replying. The auto-loop runs at \`agent_end\`; if you are capturing in turn-1 and replying in turn-2, the fact is at risk if the wake aborts.`,
        '2. **Mid-wake self-lessons** — durable rules you derive in-turn. Phrases that mark a durable rule include: ' +
          MEMORY_CAPTURE_TRIGGERS.map((kw) => `\`${kw}\``).join(', ') +
          `. Append these to \`/agents/<your-id>/MEMORY.md\`. The distill observer writes \`## Recent Interaction\` summary blocks post-\`agent_end\`, but those are summaries, not durable rules.`,
        '3. **Per-`(agent, staff)` working preferences** ("Maria handles refunds via card, not bank") → `/staff/<staffId>/MEMORY.md`. No auto-writer covers this scope.',
      ].join('\n'),
  }),
  defineIndexContributor({
    file: AGENTS_MD_FILE,
    priority: 26,
    name: 'agents.memory-conventions',
    render: () =>
      [
        '## Memory scopes',
        '',
        'Three scopes, three files. Pick by the question "whose knowledge is this?".',
        '',
        '| Scope | Path | When to write | Convention |',
        '| --- | --- | --- | --- |',
        '| agent | `/agents/<your-id>/MEMORY.md` | self-knowledge — "always do X", "from now on Y" | append dated `## YYYY-MM-DD` section, ≤12 lines |',
        '| contact | `/contacts/<id>/MEMORY.md` (prose) + `vobase contacts propose-change` (structured fields) | per-customer fact mentioned by name | append a bullet for narrative; for named scalars/`attributes.<key>` also call the verb so the change lands on the row (auto-applies for non-gated fields, pends staff review for gated ones) |',
        // Three-scope symmetric coverage. Staff guidance lives here (not in
        // team.staff-roster) because team-roster is the file index, not the
        // mutation playbook. See Architect F2.
        '| staff | `/staff/<staffId>/MEMORY.md` | per-`(agent, staff)` fact ("Maria handles refunds via card") | append bullet under `## About <name>`, ≤12 lines |',
        '',
        '**Mutation patterns** (all three scopes):',
        '- Append a bullet: `echo "- <fact>" >> <path>`.',
        '- Append a dated heredoc:',
        '  ```',
        '  cat >> <path> <<EOF',
        '',
        '  ## 2026-05-05',
        '  - <fact>',
        '  EOF',
        '  ```',
        '- Delete a stale section: `sed -i "/<old marker>/,/<old end>/d" <path>`.',
        '',
        '**Pruning:** drop bullets older than 30 days OR superseded by newer guidance; keep ≤12 lines per `##` section. Applies symmetrically to all three scopes.',
        '',
        '**Soft cap:** the `<!-- memory-budget ... cap=8000 over=true|false -->` header at the top of each MEMORY.md is a visibility hint — when `over=true`, prune before the next wake. Writes are not rejected.',
        '',
        '## Structured fields vs prose memory',
        '',
        'Two paths, picked by shape:',
        '- **Structured fields** (named scalars, `attributes.*`, segments) → `vobase contacts propose-change`. The contact row is the system of record; the verb routes through the change-proposal pipeline (auto-applies for non-gated fields, pends for staff review on gated ones). Per-resource field lists and gates are in `## Contact context` below.',
        '- **Prose narrative** (sentiment, history, working observations, multi-sentence learnings) → `MEMORY.md` via direct file writes.',
        '',
        '**When to call `propose-change`:**',
        '',
        '1. **Customer-volunteered facts** with a clear field shape. "We\'re at GK Corp, 220 employees, contract renews September." → one verb call per attribute, e.g. `vobase contacts propose-change --id <id> --field attributes.company --to "GK Corp" --rationale "Customer mentioned in chat"`.',
        '2. **High-confidence inferences** that map to a known field. Deal size implies `segments: ["enterprise"]`; tone implies `attributes.priority: "high"`. Only capture inferences you\'d defend if asked.',
        '',
        'Staff records have no CLI verb yet — staff-volunteered facts about teammates go into `/staff/<id>/MEMORY.md` instead. Sentiment, history, free-running observations always belong in `MEMORY.md`, not on the row.',
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
  const { agentId, agentDefinition, tools, agentsMdContributors, lane, triggerKind, supervisorKind, audienceTier } = ctx
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
    // they can emit lane-aware prose (e.g. messaging's supervisor-coaching
    // block) without coupling those modules to the wake harness. Readers go
    // through `getWakeAgentsMdScratch` from `~/wake/agents-md-scratch`.
    scratch: buildWakeAgentsMdScratch({ lane, triggerKind, supervisorKind }),
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
