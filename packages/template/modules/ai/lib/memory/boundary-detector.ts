import { openai } from '@ai-sdk/openai';
import { logger } from '@vobase/core';
import { type GenerateTextResult, generateText, Output } from 'ai';

import { bareModelName, models } from '../models';
import type { BoundaryResult, MemoryConfig, MemoryMessage } from './types';
import { boundaryResultSchema, defaultMemoryConfig } from './types';

/**
 * Estimate token count from text using a rough 4-chars-per-token heuristic.
 * Accurate enough for boundary detection thresholds.
 */
export function estimateTokens(text: string): number {
  return Math.ceil(text.length / 4);
}

/**
 * Compute total tokens for a list of messages.
 */
export function computeBufferTokens(messages: MemoryMessage[]): number {
  let total = 0;
  for (const m of messages) {
    if (m.content) total += estimateTokens(m.content);
  }
  return total;
}

const BOUNDARY_PROMPT = `You are a conversation segmentation system. Analyze the conversation below and determine if the most recent messages represent a meaningful topic boundary (shift in topic, intent, or temporal context) compared to earlier messages.

Consider:
- Topic shift: Has the conversation moved to a substantially different subject?
- Intent transition: Has the user's goal changed (e.g., from asking questions to making requests)?
- Temporal signals: Are there references to different time periods or "moving on"?
- Content meaningfulness: Is there enough substantive content to form a coherent memory segment?

Return shouldSplit=true if a clear boundary exists, shouldSplit=false otherwise.
Be conservative — only split on clear, meaningful boundaries, not minor topic variations.`;

interface DetectBoundaryOptions {
  messages: MemoryMessage[];
  config?: Partial<MemoryConfig>;
  /** Override LLM call for testing */
  generate?: (
    opts: Parameters<typeof generateText>[0],
  ) => Promise<GenerateTextResult<unknown, BoundaryResult>>;
}

/**
 * Detect if the current message buffer has hit a MemCell boundary.
 * Uses LLM-based topic segmentation with force-split at token/message limits.
 */
export async function detectBoundary(
  options: DetectBoundaryOptions,
): Promise<BoundaryResult> {
  const { messages, config: configOverride, generate } = options;
  const config = { ...defaultMemoryConfig, ...configOverride };

  // Force-split at hard limits regardless of LLM
  const tokenCount = computeBufferTokens(messages);
  if (tokenCount >= config.maxTokens) {
    return { shouldSplit: true, reason: `Token limit reached (${tokenCount})` };
  }
  if (messages.length >= config.maxMessages) {
    return {
      shouldSplit: true,
      reason: `Message limit reached (${messages.length})`,
    };
  }

  // Need at least 4 messages for meaningful boundary detection
  if (messages.length < 4) {
    return {
      shouldSplit: false,
      reason: 'Not enough messages for boundary detection',
    };
  }

  // Format messages for LLM
  const formatted = messages
    .map((m) => `[${m.aiRole ?? 'user'}]: ${m.content ?? ''}`)
    .join('\n');

  const generateFn = generate ?? generateText;

  try {
    const result = await generateFn({
      model: openai(bareModelName(models.gpt_mini)),
      output: Output.object({ schema: boundaryResultSchema }),
      system: BOUNDARY_PROMPT,
      prompt: formatted,
      maxOutputTokens: 100,
    });

    return result.object as BoundaryResult;
  } catch (err) {
    // LLM failure is non-fatal — don't split on error
    logger.warn('[memory] Boundary detection LLM call failed', { error: err });
    return {
      shouldSplit: false,
      reason: 'Boundary detection failed (LLM error)',
    };
  }
}
