import { Agent } from '@mastra/core/agent';
import type { MastraScorers } from '@mastra/core/evals';

import { scorers } from '../evals/scorers';
import type { AgentMeta } from '../lib/agents/define';
import { models } from '../lib/models';
import { agentModel } from '../lib/provider';
import { resolveInputProcessors } from '../processors';
import {
  bookSlotTool,
  cancelBookingTool,
  checkAvailabilityTool,
  createDraftTool,
  getConversationStateTool,
  holdTool,
  listConversationsTool,
  mentionTool,
  readConversationTool,
  reassignTool,
  rescheduleBookingTool,
  resolveConversationTool,
  scheduleFollowUpTool,
  searchKnowledgeBaseTool,
  sendCardTool,
  sendReminderTool,
  sendReplyTool,
  topicMarkerTool,
} from '../tools';

export const bookingMeta: AgentMeta = {
  id: 'booking',
  name: 'Booking Assistant',
  model: models.claude_sonnet,
  channels: ['whatsapp', 'web'],
  mode: 'full-auto',
  suggestions: [
    'I need to book an appointment',
    'Can I reschedule my booking?',
    'I want to cancel my appointment',
    'What times are available next week?',
  ],
};

const FULL_AUTO_INSTRUCTIONS = `You are a booking assistant operating in full-auto mode. You interact with customers through conversation tools — you do NOT see messages directly.

## How to interact
1. Use read_conversation to read the customer's latest messages.
2. Decide what to do (check availability, book, etc.).
3. Use send_reply to send your response back to the customer.
4. Use get_conversation_state to check conversation status if needed.
5. Use list_my_conversations to see all conversations for this contact.

## Booking rules
- Check availability, book appointments, reschedule, and cancel without human intervention.
- Send reminders for upcoming appointments using the send_reminder tool.
- Only use mention when you need human guidance without transferring ownership, or reassign when the conversation should be handled by a human.
- Always confirm details with the customer before finalizing a booking.
- Be proactive: suggest alternative times if the requested slot is unavailable.

## Important
- Always read the conversation first before responding.
- Never send empty replies. Always include meaningful content.
- Use resolve_conversation when the interaction is complete.`;

const QUALIFY_THEN_HANDOFF_INSTRUCTIONS = `You are a booking assistant operating in qualify-then-handoff mode. You interact with customers through conversation tools — you do NOT see messages directly.

## How to interact
1. Use read_conversation to read the customer's latest messages.
2. Gather information and qualify the request.
3. Use send_reply to communicate with the customer.
4. Use get_conversation_state to check conversation status if needed.

## Qualification rules
- Collect the customer's preferred dates, times, and service type.
- Check availability to narrow down options.
- Once you have qualified the request (gathered all necessary details), use reassign to hand off to a staff member with a summary of the customer's needs and available slots.
- Do NOT finalize bookings yourself — the human operator confirms and books.
- Keep the customer informed that their request is being reviewed by a team member.
- You may cancel or reschedule existing bookings if the customer explicitly requests it with clear details.

## Important
- Always read the conversation first before responding.
- Never send empty replies. Always include meaningful content.`;

function resolveInstructions(mode: AgentMeta['mode']): string {
  return mode === 'qualify-then-handoff'
    ? QUALIFY_THEN_HANDOFF_INSTRUCTIONS
    : FULL_AUTO_INSTRUCTIONS;
}

export const bookingAgent = new Agent({
  id: bookingMeta.id,
  name: bookingMeta.name,
  instructions: resolveInstructions(bookingMeta.mode),
  model: agentModel(bookingMeta.model),
  tools: {
    // Conversation tools — read/write messages via tools, not direct streaming
    read_conversation: readConversationTool,
    send_reply: sendReplyTool,
    get_conversation_state: getConversationStateTool,
    list_my_conversations: listConversationsTool,
    // Domain tools
    search_knowledge_base: searchKnowledgeBaseTool,
    check_availability: checkAvailabilityTool,
    book_slot: bookSlotTool,
    cancel_booking: cancelBookingTool,
    reschedule_booking: rescheduleBookingTool,
    send_reminder: sendReminderTool,
    mention: mentionTool,
    reassign: reassignTool,
    create_draft: createDraftTool,
    hold: holdTool,
    send_card: sendCardTool,
    resolve_conversation: resolveConversationTool,
    schedule_follow_up: scheduleFollowUpTool,
    topic_marker: topicMarkerTool,
  },
  defaultOptions: { maxSteps: 20 },
  inputProcessors: resolveInputProcessors,
  scorers: Object.fromEntries(
    scorers.map((s) => [
      s.id,
      { scorer: s, sampling: { type: 'ratio' as const, rate: 1 } },
    ]),
  ) as MastraScorers,
});
