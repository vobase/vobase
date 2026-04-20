/**
 * Frozen prompt builder.
 *
 * Computes the system prompt ONCE per wake from `AGENTS.md + SOUL.md +
 * MEMORY.md + BUSINESS.md + skills metadata`. SHA-256 hash over the rendered
 * markdown string (pre-tokenization) is exposed so the integration test can
 * assert `turn1.systemHash === turn3.systemHash` even after mid-wake writes.
 */

import type { AgentDefinition } from '@server/contracts/domain-types'
import type { Bash } from 'just-bash'

export interface FrozenPromptInput {
  bash: Bash
  agentDefinition: AgentDefinition
  organizationId: string
  contactId: string
  conversationId: string
  /** Optional override — tests can inject a stable prompt suffix. */
  staticInstructionsSuffix?: string
}

export interface FrozenPromptResult {
  system: string
  systemHash: string
}

const STATIC_INSTRUCTIONS = `
# Operating Principles

- Read /workspace/AGENTS.md for the CLI + layout reference (above).
- Read /workspace/SOUL.md for your role, scope, and tool allowlist.
- Use \`vobase <subcommand>\` for side-effecting actions; never edit
  read-only files via \`echo >\` — the dispatcher will reject them.
- Frozen zone rule: files in your frozen prompt were snapshotted at the
  start of this wake. Mid-wake writes persist, but only show up in the
  NEXT turn's side-load — NOT in the system prompt.
`.trimStart()

async function safeRead(bash: Bash, path: string): Promise<string> {
  try {
    return await bash.readFile(path)
  } catch {
    return ''
  }
}

async function safeListSkills(bash: Bash): Promise<Array<{ name: string; description: string }>> {
  try {
    // Enumerate the directory tree via `ls` against the virtual FS. We want
    // names + (if readable) the YAML frontmatter 'description' — the frozen
    // zone carries ONLY the metadata line, not full bodies.
    const names = await bash.fs.readdir('/workspace/skills')
    const out: Array<{ name: string; description: string }> = []
    for (const name of names) {
      out.push({ name, description: '' })
    }
    return out
  } catch {
    return []
  }
}

async function sha256Hex(input: string): Promise<string> {
  if (typeof Bun !== 'undefined' && typeof Bun.CryptoHasher === 'function') {
    const hasher = new Bun.CryptoHasher('sha256')
    hasher.update(input)
    return hasher.digest('hex')
  }
  const encoder = new TextEncoder()
  const buf = await crypto.subtle.digest('SHA-256', encoder.encode(input))
  return Array.from(new Uint8Array(buf))
    .map((b) => b.toString(16).padStart(2, '0'))
    .join('')
}

/**
 * Build the frozen system prompt + SHA-256 hash over its rendered string.
 * Called ONCE per wake at `agent_start`. N3 invariant: never re-read mid-wake.
 */
export async function buildFrozenPrompt(input: FrozenPromptInput): Promise<FrozenPromptResult> {
  const [agentsMd, soulMd, memoryMd, businessMd] = await Promise.all([
    safeRead(input.bash, '/workspace/AGENTS.md'),
    safeRead(input.bash, '/workspace/SOUL.md'),
    safeRead(input.bash, '/workspace/MEMORY.md'),
    safeRead(input.bash, '/workspace/drive/BUSINESS.md'),
  ])
  const skills = await safeListSkills(input.bash)

  const skillList =
    skills.length === 0
      ? '_No skills registered._'
      : skills.map((s) => `- ${s.name}${s.description ? `: ${s.description}` : ''}`).join('\n')

  // Markdown segments are separated by two newlines; this string IS what we
  // hash over. Hash is pre-tokenization per plan N3.
  const rendered = [
    '# System',
    '',
    `organization_id=${input.organizationId}`,
    `conversation_id=${input.conversationId}`,
    `contact_id=${input.contactId}`,
    `agent_id=${input.agentDefinition.id}`,
    '',
    '## AGENTS.md',
    '',
    agentsMd,
    '',
    '## SOUL.md',
    '',
    soulMd,
    '',
    '## MEMORY.md (frozen snapshot at wake start)',
    '',
    memoryMd,
    '',
    '## BUSINESS.md',
    '',
    businessMd,
    '',
    '## Skills (metadata only; `cat /workspace/skills/<name>` for full body)',
    '',
    skillList,
    '',
    input.staticInstructionsSuffix ?? STATIC_INSTRUCTIONS,
  ].join('\n')

  const systemHash = await sha256Hex(rendered)
  return { system: rendered, systemHash }
}
