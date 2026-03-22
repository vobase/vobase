/**
 * Check if AI features are configured (at least one provider API key set).
 */
export function isAIConfigured(): boolean {
  return !!(
    process.env.OPENAI_API_KEY ||
    process.env.GOOGLE_GENERATIVE_AI_API_KEY ||
    process.env.ANTHROPIC_API_KEY
  );
}
