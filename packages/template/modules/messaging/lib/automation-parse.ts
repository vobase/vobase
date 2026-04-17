import { logger, type VobaseDb, validation } from '@vobase/core';

import { models } from '../../agents/mastra/lib/models';
import { buildSystemPrompt } from './automation-parse-prompt';
import { type DraftRule, DraftRuleSchema } from './automation-parse-schema';

interface ParseCtx {
  db: VobaseDb;
  modelId?: string;
}

function hasLlmCredentials(): boolean {
  return !!(
    process.env.BIFROST_API_KEY ||
    process.env.OPENAI_API_KEY ||
    process.env.ANTHROPIC_API_KEY ||
    process.env.GOOGLE_GENERATIVE_AI_API_KEY
  );
}

export async function parseRuleFromPrompt(
  prompt: string,
  ctx: ParseCtx,
  language = 'en',
): Promise<DraftRule> {
  if (!hasLlmCredentials()) {
    throw validation({ llm: 'not configured' });
  }

  let generateObject: typeof import('ai').generateObject;
  let getChatModel: typeof import('../../agents/mastra/lib/provider').getChatModel;
  try {
    ({ generateObject } = await import('ai'));
    ({ getChatModel } = await import('../../agents/mastra/lib/provider'));
  } catch (err) {
    logger.warn('[automation-parse] Failed to load AI SDK modules', { err });
    throw validation({ llm: 'not configured' });
  }

  const systemPrompt = await buildSystemPrompt(ctx, language);
  // gpt_mini: claude-haiku rejects JSON schemas with min/max on integer fields
  // (Anthropic's OpenAI-compat endpoint doesn't accept `minimum`/`maximum`).
  const modelId = ctx.modelId ?? models.gpt_mini;

  const { object } = await generateObject({
    model: getChatModel(modelId),
    schema: DraftRuleSchema,
    system: systemPrompt,
    prompt,
    // DraftRuleSchema has optional fields throughout; OpenAI's strict structured
    // output mode requires every property in `required`, which rejects `.optional()`.
    providerOptions: { openai: { strictJsonSchema: false } },
  });

  return object;
}
