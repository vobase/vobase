import { type Static, Type } from '@sinclair/typebox'

import { defineAgentTool } from '../shared/define-tool'

export const BookSlotInputSchema = Type.Object({
  slotId: Type.String({ minLength: 1 }),
  contactId: Type.String({ minLength: 1 }),
  notes: Type.Optional(Type.String()),
})

export type BookSlotInput = Static<typeof BookSlotInputSchema>

export const bookSlotTool = defineAgentTool({
  name: 'book_slot',
  description:
    'Book a calendar slot for the contact. Side-effect only: the customer sees nothing until you follow up with `reply` or `send_card` to confirm. Requires staff approval if agent.bookSlotApprovalRequired=true.',
  schema: BookSlotInputSchema,
  errorCode: 'BOOK_SLOT_ERROR',
  requiresApproval: true,
  // biome-ignore lint/suspicious/useAwait: stub awaits a future calendar integration
  async run(args) {
    return { slotId: args.slotId, confirmed: true }
  },
})
