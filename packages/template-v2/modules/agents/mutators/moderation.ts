/**
 * moderationMutator — content-policy gate at reply/send_card/send_file/create_draft boundaries.
 * Spec §12.1 mutator #1, §12.3 first-block-wins.
 *
 * Two-stage check:
 *  1. Blocklist (regex, always runs) — fast path, fires first.
 *  2. LLM check (`llmCall('moderation', ...)`) — gated by VOBASE_ENABLE_MODERATION_LLM=true.
 *
 * On block: emits `moderation_blocked` via ctx.persistEvent + returns { action:'block' }.
 * First-block-wins: once any check returns a block, subsequent checks are skipped (handled
 * by the mutator chain in §12.3 — this mutator returns immediately on first match).
 */

import type { ModerationCategory } from '@server/contracts/domain-types'
import type { AgentMutator, AgentStep, MutatorContext, MutatorDecision } from '@server/contracts/mutator'

const MODERATION_TOOL_NAMES = new Set(['reply', 'send_card', 'send_file', 'create_draft'])

interface BlocklistEntry {
  pattern: RegExp
  category: ModerationCategory
  ruleId: string
}

const BLOCKLIST: BlocklistEntry[] = [
  {
    pattern: /ignore\s+(previous|all|your)\s+instructions?/i,
    category: 'prompt_injection',
    ruleId: 'threat.prompt_injection',
  },
  {
    pattern: /reveal\s+(your\s+)?(system\s+prompt|instructions?|context)/i,
    category: 'prompt_injection',
    ruleId: 'threat.system_prompt_extract',
  },
  {
    pattern: /you\s+are\s+now\s+(a\s+)?(?!vobase|meridian)/i,
    category: 'prompt_injection',
    ruleId: 'threat.role_override',
  },
  {
    pattern: /\b(kill|murder|rape|torture)\s+(yourself|himself|herself|themselves)\b/i,
    category: 'violence',
    ruleId: 'violence.self_harm_directive',
  },
  {
    pattern: /\b(fuck|cunt|bastard)\s+(you|off|this)/i,
    category: 'harassment',
    ruleId: 'harassment.profanity_directed',
  },
]

function extractContent(step: AgentStep): string {
  const args = step.args as Record<string, unknown>
  if (typeof args.text === 'string') return args.text
  if (typeof args.content === 'string') return args.content
  if (typeof args.body === 'string') return args.body
  if (typeof args.message === 'string') return args.message
  return JSON.stringify(args)
}

export const moderationMutator: AgentMutator = {
  id: 'agents:moderation',

  async before(step: AgentStep, ctx: MutatorContext): Promise<MutatorDecision | undefined> {
    if (!MODERATION_TOOL_NAMES.has(step.toolName)) return undefined

    const content = extractContent(step)

    // Stage 1: blocklist — always runs; first match wins
    for (const { pattern, category, ruleId } of BLOCKLIST) {
      if (pattern.test(content)) {
        await ctx.persistEvent({
          type: 'moderation_blocked',
          toolName: step.toolName,
          toolCallId: step.toolCallId,
          ruleId,
          reason: `moderation_failed:${category}`,
          ts: new Date(),
          wakeId: ctx.wakeId,
          conversationId: ctx.conversationId,
          tenantId: ctx.tenantId,
          turnIndex: 0,
        })
        return { action: 'block', reason: `moderation_failed:${category}` }
      }
    }

    // Stage 2: LLM check — optional, gated by env flag
    if (process.env.VOBASE_ENABLE_MODERATION_LLM !== 'true') return undefined

    const { moderationSystemPrompt, buildModerationUserMessage } = await import(
      '@modules/agents/llm-prompts/moderation'
    )

    const result = await ctx.llmCall('moderation', {
      system: moderationSystemPrompt,
      messages: [{ role: 'user', content: buildModerationUserMessage(step.toolName, content) }],
    })

    let parsed: { safe: boolean; category?: string; reason?: string }
    try {
      parsed = JSON.parse(result.content) as typeof parsed
    } catch {
      // Unparseable response → assume safe; don't block
      ctx.logger.warn({ content: result.content }, 'moderation: failed to parse LLM response, allowing through')
      return undefined
    }

    if (!parsed.safe) {
      const category = (parsed.category ?? 'policy_violation') as ModerationCategory
      const ruleId = `llm.${category}`
      await ctx.persistEvent({
        type: 'moderation_blocked',
        toolName: step.toolName,
        toolCallId: step.toolCallId,
        ruleId,
        reason: `moderation_failed:${category}`,
        ts: new Date(),
        wakeId: ctx.wakeId,
        conversationId: ctx.conversationId,
        tenantId: ctx.tenantId,
        turnIndex: 0,
      })
      return { action: 'block', reason: `moderation_failed:${category}` }
    }

    return undefined
  },
}
