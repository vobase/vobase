/**
 * Frozen prompt builder.
 *
 * Computes the system prompt ONCE per wake from `AGENTS.md + MEMORY.md +
 * BUSINESS.md + skills metadata`. SHA-256 hash over the rendered markdown
 * string (pre-tokenization) is exposed so the integration test can assert
 * `turn1.systemHash === turn3.systemHash` even after mid-wake writes.
 */

import type { AgentDefinition } from '@modules/agents/schema'
import type { HarnessPlatformHint } from '@vobase/core'
import type { Bash } from 'just-bash'

/**
 * Session-level orientation snapshot the agent sees once at wake start.
 *
 * All fields are nullable because the wake-handler resolves them lazily from
 * DB queries at the start of the wake; missing fields are rendered as
 * `(unknown)` / `unassigned` rather than omitted so the section stays
 * structurally identical across wakes (helps prompt-cache stability).
 */
export interface SessionContext {
  channelKind: string | null
  channelLabel: string | null
  contactDisplayName: string | null
  contactIdentifier: string | null
  staffAssigneeDisplayName: string | null
  conversationStatus: string | null
  customerSince: Date | null
}

export interface FrozenPromptInput {
  bash: Bash
  agentDefinition: AgentDefinition
  organizationId: string
  contactId: string
  channelInstanceId: string
  /** Session-level context snapshot. Injected as a `## Session context` block. */
  sessionContext?: SessionContext
  /** Channel-specific authoring guidance keyed by channel kind. */
  platformHint?: HarnessPlatformHint
  /** Optional override — tests can inject a stable prompt suffix. */
  staticInstructionsSuffix?: string
}

export interface FrozenPromptResult {
  system: string
  systemHash: string
}

const STATIC_INSTRUCTIONS = `
# Operating Principles

- Read AGENTS.md for the CLI + layout reference (above).
- Use \`vobase <subcommand>\` for side-effecting actions; never edit read-only files via \`echo >\` — the dispatcher will reject them.
- Frozen zone rule: files in your frozen prompt were snapshotted at the start of this wake. Mid-wake writes persist, but only show up in the NEXT turn's side-load — NOT in the system prompt.
`.trimStart()

/**
 * Build the active-IDs preamble rendered at the top of the system prompt.
 *
 * Conversational wakes reference the contact + channel-instance folder pair so
 * the agent knows where to read the customer's latest messages. Non-
 * conversational wakes emit only the agent-self line — no empty-slot
 * interpolations.
 */
export function buildActiveIdsPreamble(ids: {
  agentId: string
  contactId?: string
  channelInstanceId?: string
}): string {
  if (ids.contactId && ids.channelInstanceId) {
    return `You are /agents/${ids.agentId}/, conversing with /contacts/${ids.contactId}/ via /contacts/${ids.contactId}/${ids.channelInstanceId}/. Latest at /contacts/${ids.contactId}/${ids.channelInstanceId}/messages.md.`
  }
  return `You are /agents/${ids.agentId}/.`
}

async function safeRead(bash: Bash, path: string): Promise<string> {
  try {
    return await bash.readFile(path)
  } catch {
    return ''
  }
}

async function safeListSkills(bash: Bash, agentId: string): Promise<Array<{ name: string; description: string }>> {
  try {
    const names = await bash.fs.readdir(`/agents/${agentId}/skills`)
    const out: Array<{ name: string; description: string }> = []
    for (const name of names) {
      out.push({ name, description: '' })
    }
    return out
  } catch {
    return []
  }
}

function renderSessionContext(ctx: SessionContext | undefined): string {
  if (!ctx) return '_No session context resolved for this wake._'
  const channel = ctx.channelKind
    ? `${ctx.channelKind}${ctx.channelLabel ? ` (${ctx.channelLabel})` : ''}`
    : '(unknown)'
  const contact = ctx.contactDisplayName ?? ctx.contactIdentifier ?? '(unknown)'
  const identifier = ctx.contactIdentifier && ctx.contactDisplayName ? ` <${ctx.contactIdentifier}>` : ''
  const assignee = ctx.staffAssigneeDisplayName ?? 'unassigned (agent owns the reply)'
  const status = ctx.conversationStatus ?? '(unknown)'
  const since = ctx.customerSince ? formatDate(ctx.customerSince) : '(unknown)'
  return [
    `- Channel: ${channel}`,
    `- Contact: ${contact}${identifier}`,
    `- Staff assignee: ${assignee}`,
    `- Conversation status: ${status}`,
    `- Customer since: ${since}`,
  ].join('\n')
}

function renderPlatformHint(hint: HarnessPlatformHint | undefined): string {
  if (!hint) return '_No channel-specific guidance available._'
  return hint.hint
}

function formatDate(d: Date): string {
  const year = d.getUTCFullYear()
  const month = String(d.getUTCMonth() + 1).padStart(2, '0')
  const day = String(d.getUTCDate()).padStart(2, '0')
  return `${year}-${month}-${day}`
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
 * Called ONCE per wake at `agent_start`. Never re-read mid-wake.
 */
export async function buildFrozenPrompt(input: FrozenPromptInput): Promise<FrozenPromptResult> {
  const agentId = input.agentDefinition.id
  const [agentsMd, memoryMd, businessMd] = await Promise.all([
    safeRead(input.bash, `/agents/${agentId}/AGENTS.md`),
    safeRead(input.bash, `/agents/${agentId}/MEMORY.md`),
    safeRead(input.bash, '/drive/BUSINESS.md'),
  ])
  const skills = await safeListSkills(input.bash, agentId)

  const skillList =
    skills.length === 0
      ? '_No skills registered._'
      : skills.map((s) => `- ${s.name}${s.description ? `: ${s.description}` : ''}`).join('\n')

  const preamble = buildActiveIdsPreamble({
    agentId,
    contactId: input.contactId,
    channelInstanceId: input.channelInstanceId,
  })

  const sessionContextBlock = renderSessionContext(input.sessionContext)
  const platformHintBlock = renderPlatformHint(input.platformHint)

  // Markdown segments are separated by two newlines; this string IS what we
  // hash over. Hash is pre-tokenization.
  const rendered = [
    preamble,
    '',
    '# System',
    '',
    `organization_id=${input.organizationId}`,
    `channel_instance_id=${input.channelInstanceId}`,
    `contact_id=${input.contactId}`,
    `agent_id=${agentId}`,
    '',
    '## Session context',
    '',
    sessionContextBlock,
    '',
    '## Platform hints',
    '',
    platformHintBlock,
    '',
    '## AGENTS.md',
    '',
    agentsMd,
    '',
    '## MEMORY.md (frozen snapshot at wake start)',
    '',
    memoryMd,
    '',
    '## BUSINESS.md',
    '',
    businessMd,
    '',
    `## Skills (metadata only; \`cat /agents/${agentId}/skills/<name>\` for full body)`,
    '',
    skillList,
    '',
    input.staticInstructionsSuffix ?? STATIC_INSTRUCTIONS,
  ].join('\n')

  const systemHash = await sha256Hex(rendered)
  return { system: rendered, systemHash }
}
