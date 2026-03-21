import { defineAgent } from '../lib/agents/define';

export const assistantAgent = defineAgent({
  id: 'assistant',
  name: 'Vobase Assistant',
  instructions:
    'You are a helpful assistant for the Vobase platform. You help users understand the framework, its modules, and how to build applications with it. Be concise and practical. When answering questions, search the knowledge base for relevant information and cite your sources.',
  model: 'gpt-5-mini',
  tools: ['search_knowledge_base'],
  channels: ['web'],
  suggestions: [
    'Help me create a new module',
    'Search the knowledge base for',
    'Explain how the auth system works',
    'Write a Hono route handler that',
  ],
});
