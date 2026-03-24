import { Agent } from '@mastra/core/agent';

import type { AgentMeta } from '../lib/agents/define';
import { models } from '../lib/models';
import { resolveInputProcessors, resolveOutputProcessors } from '../processors';
import {
  addLabelTool,
  assignTicketTool,
  escalateTicketTool,
  resolveConversationTool,
  searchKnowledgeBaseTool,
  setPriorityTool,
  snoozeTicketTool,
} from '../tools';

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
  tools: {
    search_knowledge_base: searchKnowledgeBaseTool,
    escalate_ticket: escalateTicketTool,
    set_priority: setPriorityTool,
    assign_ticket: assignTicketTool,
    add_label: addLabelTool,
    snooze_ticket: snoozeTicketTool,
    resolve_conversation: resolveConversationTool,
  },
  defaultOptions: { maxSteps: 5 },
  inputProcessors: resolveInputProcessors,
  outputProcessors: resolveOutputProcessors,
});
