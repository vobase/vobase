import { Agent } from '@mastra/core/agent';

import { getAIConfig } from '../../../lib/ai';
import type { AgentMeta } from '../lib/agents/define';
import {
  resolveInputProcessors,
  resolveOutputProcessors,
} from '../lib/agents/processors';
import { toMastraModelId } from '../lib/agents/shared';
import { escalateToStaffTool } from '../lib/tools/escalate';
import { searchKnowledgeBaseTool } from '../lib/tools/search-kb';

const config = getAIConfig();

export const quickHelperAgent = new Agent({
  id: 'quick-helper',
  name: 'Lead Qualifier',
  instructions: `You are a friendly lead qualification agent for a custom software agency. Your job is to have a natural conversation with potential clients to understand their project needs and qualify them as leads.

Gather the following information through conversation (don't ask all at once — be conversational):
- What kind of software project they need (web app, mobile app, API, automation, etc.)
- Their timeline and urgency
- Approximate budget range
- Whether they have an existing system or starting from scratch
- Their industry or business type
- Team size and technical resources they already have

Be warm, professional, and helpful. Ask follow-up questions based on their answers. If they mention a specific technology or challenge, show genuine interest and ask to understand more.

After gathering enough information, provide a brief summary of what you understood and suggest next steps (like scheduling a discovery call with the team).

Do NOT be pushy or salesy. Focus on understanding their needs.`,
  model: toMastraModelId(config.model),
  tools: {
    search_knowledge_base: searchKnowledgeBaseTool,
    escalate_to_staff: escalateToStaffTool,
  },
  defaultOptions: { maxSteps: 5 },
  inputProcessors: resolveInputProcessors,
  outputProcessors: resolveOutputProcessors,
});

export const quickHelperMeta: AgentMeta = {
  id: 'quick-helper',
  name: 'Lead Qualifier',
  channels: ['web'],
  suggestions: [
    'I need a custom web application built',
    "We're looking to automate our business processes",
    'I have an existing app that needs a redesign',
    'We need help building an MVP for our startup',
  ],
};
