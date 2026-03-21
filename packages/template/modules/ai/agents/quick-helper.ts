import { defineAgent } from '../lib/agents/define';

export const quickHelperAgent = defineAgent({
  id: 'quick-helper',
  name: 'Quick Helper',
  instructions:
    'You are a fast, lightweight assistant. Answer questions concisely. Prefer short code snippets over long explanations. Skip preamble. When answering questions, search the knowledge base for relevant information and cite your sources.',
  model: 'claude-haiku-4-5',
  tools: ['search_knowledge_base'],
  channels: ['web'],
  suggestions: [
    'Write a TypeScript function that',
    'Debug this error',
    'Refactor this code to be cleaner',
    'What does this code do?',
  ],
});
