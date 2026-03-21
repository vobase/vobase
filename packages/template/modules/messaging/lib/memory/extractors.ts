import { openai } from '@ai-sdk/openai';
import { generateText, Output } from 'ai';

import { getAIConfig } from '../../../../lib/ai';
import type { Episode, EventLogEntry, MemoryMessage } from './types';
import { episodeSchema, eventLogSchema } from './types';

const EPISODE_PROMPT = `You are a memory extraction system. Given a conversation segment, write a concise third-person narrative summary (an "episode") that captures the key information exchanged.

Rules:
- Write in third person (e.g., "The user asked about...", "The assistant explained...")
- Preserve specific details: names, numbers, dates, times, amounts, technical terms
- Capture the intent and outcome of the conversation segment
- Keep it concise (2-5 sentences) but information-dense
- Include any decisions made or actions agreed upon`;

const EVENT_LOG_PROMPT = `You are a fact extraction system. Given a conversation segment, extract all atomic facts as individual sentences.

Rules:
- Each fact must be a single, self-contained sentence
- Use explicit attribution (e.g., "User mentioned that...", "User's email is...")
- Preserve exact values: names, numbers, dates, addresses, preferences
- Include facts about: personal details, preferences, decisions, commitments, events mentioned
- If a time/date is mentioned or can be inferred, include it
- Do NOT include conversational filler or meta-commentary about the conversation itself
- Be thorough — extract every factual claim, even if it seems minor`;

interface ExtractOptions {
  messages: MemoryMessage[];
  /** Override LLM call for testing */
  generate?: typeof generateText;
}

/**
 * Extract a third-person episode narrative from a conversation segment.
 */
export async function extractEpisode(
  options: ExtractOptions,
): Promise<Episode> {
  const { messages, generate } = options;
  const aiConfig = getAIConfig();
  const generateFn = generate ?? generateText;

  const formatted = messages
    .map((m) => `[${m.aiRole ?? 'user'}]: ${m.content ?? ''}`)
    .join('\n');

  const result = await generateFn({
    model: openai(aiConfig.model),
    output: Output.object({ schema: episodeSchema }),
    system: EPISODE_PROMPT,
    prompt: formatted,
    maxOutputTokens: 500,
  });

  return result.output;
}

/**
 * Extract atomic facts (event log entries) from a conversation segment.
 */
export async function extractEventLogs(
  options: ExtractOptions,
): Promise<EventLogEntry[]> {
  const { messages, generate } = options;
  const aiConfig = getAIConfig();
  const generateFn = generate ?? generateText;

  const formatted = messages
    .map((m) => `[${m.aiRole ?? 'user'}]: ${m.content ?? ''}`)
    .join('\n');

  const result = await generateFn({
    model: openai(aiConfig.model),
    output: Output.object({ schema: eventLogSchema }),
    system: EVENT_LOG_PROMPT,
    prompt: formatted,
    maxOutputTokens: 1000,
  });

  return result.output.facts;
}
