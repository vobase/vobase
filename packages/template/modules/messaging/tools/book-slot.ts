import { type Static, Type } from '@sinclair/typebox'
import { defineAgentTool } from '@vobase/core'

export const BookSlotInputSchema = Type.Object({
  slotId: Type.String({ minLength: 1 }),
  contactId: Type.String({ minLength: 1 }),
  notes: Type.Optional(Type.String()),
})

export type BookSlotInput = Static<typeof BookSlotInputSchema>

export const bookSlotTool = defineAgentTool({
  name: 'book_slot',
  description: 'Book a calendar slot for the contact. Requires staff approval if agent.bookSlotApprovalRequired=true.',
  schema: BookSlotInputSchema,
  errorCode: 'BOOK_SLOT_ERROR',
  requiresApproval: true,
  audience: 'customer',
  lane: 'conversation',
  prompt:
    'Side-effect only: the customer sees nothing from this tool itself. After a successful booking, follow up with `reply` (or `send_card`) to confirm the appointment time + any next steps. Slot ids come from your earlier slot lookup — never fabricate them.',
  // biome-ignore lint/suspicious/useAwait: stub awaits a future calendar integration
  async run(args) {
    return { slotId: args.slotId, confirmed: true }
  },
})
