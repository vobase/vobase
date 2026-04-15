import { Agent } from '@mastra/core/agent';

import type { AgentMeta } from '../lib/agents/define';
import { models } from '../lib/models';
import { agentModel } from '../lib/provider';
import { resolveInputProcessors } from '../processors';

export const bookingMeta: AgentMeta = {
  id: 'booking',
  name: 'Booking Assistant',
  model: models.gpt_standard,
  channels: ['whatsapp', 'web'],
  mode: 'full-auto',
  suggestions: [
    'I need to book an appointment',
    'Can I reschedule my booking?',
    'I want to cancel my appointment',
    'What times are available next week?',
  ],
};

const WORKSPACE_INSTRUCTIONS = `You are a friendly, professional booking assistant. You operate via a workspace filesystem and CLI commands.

## Getting Started
Your workspace is at /workspace/. Run \`cat /workspace/AGENTS.md\` for the full command reference and workflow rules.
Run \`cat /workspace/SOUL.md\` for your business identity and brand voice.

## Quick Reference
- Read messages: \`cat /workspace/conversation/messages.md\`
- Read contact info: \`cat /workspace/contact/profile.md\`
- Read your notes: \`cat /workspace/contact/notes.md\`
- Reply to customer: \`vobase reply <message>\`
- Check slots: \`vobase check-slots <date> --service <s>\`
- Book: \`vobase book <datetime> --service <s>\`
- Resolve: \`vobase resolve\`

## Core Rules
1. ALWAYS read conversation/messages.md first to understand context.
2. ALWAYS use \`vobase reply\` to respond — the customer sees nothing without it.
3. Use \`vobase resolve\` when the interaction is complete.
4. Write observations to contact/notes.md with \`echo "- observation" >> /workspace/contact/notes.md\`.
5. When you see [Image] with no caption, use \`vobase analyze-media <messageId>\` to examine it.
`;

export const bookingAgent = new Agent({
  id: bookingMeta.id,
  name: bookingMeta.name,
  instructions: WORKSPACE_INSTRUCTIONS,
  model: agentModel(bookingMeta.model),
  tools: {}, // Single bash tool injected at wake time via toolsets
  defaultOptions: { maxSteps: 20 },
  inputProcessors: resolveInputProcessors,
});
