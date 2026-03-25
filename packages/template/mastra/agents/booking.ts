import { Agent } from '@mastra/core/agent';

import type { AgentMeta } from '../lib/agents/define';
import { models } from '../lib/models';
import { resolveInputProcessors, resolveOutputProcessors } from '../processors';
import {
  bookSlotTool,
  cancelBookingTool,
  checkAvailabilityTool,
  consultHumanTool,
  rescheduleBookingTool,
  searchKnowledgeBaseTool,
  sendReminderTool,
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

const FULL_AUTO_INSTRUCTIONS = `You are a booking assistant operating in full-auto mode. Handle the entire booking flow autonomously:
- Check availability, book appointments, reschedule, and cancel without human intervention.
- Send reminders for upcoming appointments using the send_reminder tool.
- Only use consult_human when you encounter a situation that genuinely requires human judgment (e.g., special pricing, complex scheduling conflicts, customer complaints).
- Always confirm details with the customer before finalizing a booking.
- Be proactive: suggest alternative times if the requested slot is unavailable.`;

const QUALIFY_THEN_HANDOFF_INSTRUCTIONS = `You are a booking assistant operating in qualify-then-handoff mode. Your role is to gather information and qualify the request, then hand off to a human for final decisions:
- Collect the customer's preferred dates, times, and service type.
- Check availability to narrow down options.
- Once you have qualified the request (gathered all necessary details), use consult_human to hand off to a staff member with a summary of the customer's needs and available slots.
- Do NOT finalize bookings yourself — the human operator confirms and books.
- Keep the customer informed that their request is being reviewed by a team member.
- You may cancel or reschedule existing bookings if the customer explicitly requests it with clear details.`;

function resolveInstructions(mode: AgentMeta['mode']): string {
  return mode === 'qualify-then-handoff'
    ? QUALIFY_THEN_HANDOFF_INSTRUCTIONS
    : FULL_AUTO_INSTRUCTIONS;
}

export const bookingAgent = new Agent({
  id: bookingMeta.id,
  name: bookingMeta.name,
  instructions: resolveInstructions(bookingMeta.mode),
  model: bookingMeta.model,
  tools: {
    search_knowledge_base: searchKnowledgeBaseTool,
    check_availability: checkAvailabilityTool,
    book_slot: bookSlotTool,
    cancel_booking: cancelBookingTool,
    reschedule_booking: rescheduleBookingTool,
    send_reminder: sendReminderTool,
    consult_human: consultHumanTool,
  },
  defaultOptions: { maxSteps: 5 },
  inputProcessors: resolveInputProcessors,
  outputProcessors: resolveOutputProcessors,
});
