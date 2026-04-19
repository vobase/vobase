import { appendCardMessage } from '@modules/inbox/service/messages'
import type { AgentTool, ToolContext } from '@server/contracts/tool'
import type { ToolResult } from '@server/contracts/tool-result'
import { z } from 'zod'

// Zod mirror of spec §10.1 CardElementSchema (TypeBox shape adopted 1:1)
const ButtonStyleSchema = z.enum(['primary', 'danger', 'default'])
const TextStyleSchema = z.enum(['plain', 'bold', 'muted'])

const ButtonElementSchema = z.object({
  type: z.literal('button'),
  id: z.string().min(1),
  label: z.string().min(1),
  style: ButtonStyleSchema.optional(),
  value: z.string().optional(),
  disabled: z.boolean().optional(),
  actionType: z.enum(['action', 'modal']).optional(),
})

const LinkButtonElementSchema = z.object({
  type: z.literal('link-button'),
  url: z.string().url(),
  label: z.string().min(1),
  style: ButtonStyleSchema.optional(),
})

const TextElementSchema = z.object({
  type: z.literal('text'),
  content: z.string(),
  style: TextStyleSchema.optional(),
})

const ImageElementSchema = z.object({
  type: z.literal('image'),
  url: z.string().url(),
  alt: z.string().optional(),
})

const DividerElementSchema = z.object({ type: z.literal('divider') })

const FieldElementSchema = z.object({
  type: z.literal('field'),
  label: z.string(),
  value: z.string(),
})

const FieldsElementSchema = z.object({
  type: z.literal('fields'),
  children: z.array(FieldElementSchema).min(1).max(10),
})

const LinkElementSchema = z.object({
  type: z.literal('link'),
  url: z.string().url(),
  label: z.string(),
})

const ActionsElementSchema = z.object({
  type: z.literal('actions'),
  children: z
    .array(z.union([ButtonElementSchema, LinkButtonElementSchema]))
    .min(1)
    .max(10),
})

const CardChildSchema = z.discriminatedUnion('type', [
  TextElementSchema,
  ImageElementSchema,
  DividerElementSchema,
  ActionsElementSchema,
  FieldsElementSchema,
  LinkElementSchema,
])

export const CardElementSchema = z.object({
  type: z.literal('card'),
  title: z.string().optional(),
  subtitle: z.string().optional(),
  imageUrl: z.string().url().optional(),
  children: z.array(CardChildSchema).min(1).max(20),
})

export type CardElement = z.infer<typeof CardElementSchema>

export const sendCardTool: AgentTool<CardElement, { messageId: string }> = {
  name: 'send_card',
  parallelGroup: 'never',
  description:
    'PREFERRED reply format — send a rich interactive card. Use this whenever the customer has options to choose, confirm, compare, or act on (pricing, plans, refund decisions, booking slots, yes/no with consequences, lists of 2+ choices, how-to with a CTA). Cards let the customer one-tap their next move instead of typing. Requires staff approval if agent.cardApprovalRequired=true. Fall back to `reply` only for pure acknowledgements and free-form questions.',
  inputSchema: CardElementSchema,
  requiresApproval: true,

  async execute(args, ctx: ToolContext): Promise<ToolResult<{ messageId: string }>> {
    const parsed = CardElementSchema.safeParse(args)
    if (!parsed.success) {
      return { ok: false, error: 'Invalid card input', errorCode: 'VALIDATION_ERROR', details: parsed.error.issues }
    }

    const msg = await appendCardMessage({
      conversationId: ctx.conversationId,
      tenantId: ctx.tenantId,
      agentId: ctx.agentId,
      wakeId: ctx.wakeId,
      turnIndex: ctx.turnIndex,
      toolCallId: ctx.toolCallId,
      card: parsed.data,
    })

    return { ok: true, content: { messageId: msg.id } }
  },
}
