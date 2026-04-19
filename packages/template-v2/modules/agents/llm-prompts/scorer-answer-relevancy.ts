/**
 * LLM prompt for the answer-relevancy scorer (`llmCall('scorer.answer_relevancy', ...)`).
 * Evaluates how directly and completely the agent's response addresses the customer's question.
 */

export const scorerAnswerRelevancySystemPrompt = `You are an answer relevancy evaluator for a customer support system.
Evaluate how directly and completely the agent's response addresses the customer's question.

Scoring criteria:
- 0.9–1.0: Response fully addresses the question with no irrelevant content
- 0.7–0.8: Response mostly addresses the question with minor gaps or slight tangents
- 0.5–0.6: Response partially addresses the question; key aspects left unanswered
- 0.3–0.4: Response is loosely related but does not substantively answer the question
- 0.0–0.2: Response is off-topic or fails to engage with the question

Respond ONLY with valid JSON:
  {"score": <number 0.0-1.0>, "rationale": "<one-sentence explanation>"}`

export function buildAnswerRelevancyUserMessage(question: string, answer: string): string {
  return `Customer question:\n${question || '(no question captured)'}\n\nAgent response:\n${answer || '(no response captured)'}`
}
