import { Type } from '@mariozechner/pi-ai'
import type { AgentTool, ToolContext } from '@server/contracts/tool'
import type { ToolResult } from '@server/contracts/tool-result'
import type { Static } from '@sinclair/typebox'
import { Value } from '@sinclair/typebox/value'

export const BookSlotInputSchema = Type.Object({
  slotId: Type.String({ minLength: 1 }),
  contactId: Type.String({ minLength: 1 }),
  notes: Type.Optional(Type.String()),
})

export type BookSlotInput = Static<typeof BookSlotInputSchema>

function firstError(value: unknown): string {
  const first = Value.Errors(BookSlotInputSchema, value).First()
  return first ? `${first.path || 'root'}: ${first.message}` : 'invalid input'
}

export const bookSlotTool: AgentTool<BookSlotInput, { slotId: string; confirmed: boolean }> = {
  name: 'book_slot',
  description: 'Book a calendar slot for the contact. Requires staff approval if agent.bookSlotApprovalRequired=true.',
  inputSchema: BookSlotInputSchema,
  requiresApproval: true,
  parallelGroup: 'never',

  async execute(args, _ctx: ToolContext): Promise<ToolResult<{ slotId: string; confirmed: boolean }>> {
    if (!Value.Check(BookSlotInputSchema, args)) {
      return {
        ok: false,
        error: `Invalid book_slot input — ${firstError(args)}`,
        errorCode: 'VALIDATION_ERROR',
      }
    }

    // Phase 2 stub — calendar integration deferred to Phase 3
    return { ok: true, content: { slotId: args.slotId, confirmed: true } }
  },
}
