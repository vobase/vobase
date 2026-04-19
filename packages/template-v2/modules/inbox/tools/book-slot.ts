import type { AgentTool, ToolContext } from '@server/contracts/tool'
import type { ToolResult } from '@server/contracts/tool-result'
import { z } from 'zod'

const BookSlotInputSchema = z.object({
  slotId: z.string().min(1),
  contactId: z.string().min(1),
  notes: z.string().optional(),
})

export type BookSlotInput = z.infer<typeof BookSlotInputSchema>

export const bookSlotTool: AgentTool<BookSlotInput, { slotId: string; confirmed: boolean }> = {
  name: 'book_slot',
  description: 'Book a calendar slot for the contact. Requires staff approval if agent.bookSlotApprovalRequired=true.',
  inputSchema: BookSlotInputSchema,
  requiresApproval: true,
  parallelGroup: 'never',

  async execute(args, _ctx: ToolContext): Promise<ToolResult<{ slotId: string; confirmed: boolean }>> {
    const parsed = BookSlotInputSchema.safeParse(args)
    if (!parsed.success) {
      return {
        ok: false,
        error: 'Invalid book_slot input',
        errorCode: 'VALIDATION_ERROR',
        details: parsed.error.issues,
      }
    }

    // Phase 2 stub — calendar integration deferred to Phase 3
    return { ok: true, content: { slotId: parsed.data.slotId, confirmed: true } }
  },
}
