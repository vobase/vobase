/**
 * Check if AI features are configured (Bifrost gateway or at least one provider API key).
 */
export function isAIConfigured(): boolean {
  return !!(
    process.env.BIFROST_API_KEY ||
    process.env.OPENAI_API_KEY ||
    process.env.GOOGLE_GENERATIVE_AI_API_KEY ||
    process.env.ANTHROPIC_API_KEY
  );
}
