import { Agent } from '@mastra/core/agent';

import type { AgentMeta } from '../lib/agents/define';
import {
  resolveInputProcessors,
  resolveOutputProcessors,
} from '../lib/agents/processors';
import { models } from '../lib/models';
import { searchKnowledgeBaseTool } from '../lib/tools/search-kb';

export const assistantMeta: AgentMeta = {
  id: 'assistant',
  name: 'Vobase Assistant',
  model: models.claude_sonnet,
  channels: ['web'],
  suggestions: [
    'Help me create a new module',
    'Search the knowledge base for',
    'Explain how the auth system works',
    'Write a Hono route handler that',
  ],
};

export const assistantAgent = new Agent({
  id: assistantMeta.id,
  name: assistantMeta.name,
  instructions:
    'You are a helpful assistant for the Vobase platform. You help users understand the framework, its modules, and how to build applications with it. Be concise and practical. When answering questions, search the knowledge base for relevant information and cite your sources.',
  model: assistantMeta.model,
  tools: { search_knowledge_base: searchKnowledgeBaseTool },
  defaultOptions: { maxSteps: 5 },
  inputProcessors: resolveInputProcessors,
  outputProcessors: resolveOutputProcessors,
});
